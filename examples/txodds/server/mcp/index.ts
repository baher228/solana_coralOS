import type http from 'node:http'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult, GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { jobs, saveAgents, saveJobs } from '../store.js'
import type { AgentAuth, Job } from '../types.js'
import type { HandlerOptions } from '../http/types.js'
import { runBackendTicks } from '../http/ticks.js'
import { agentJob, requireAgentAuth } from '../http/agent.js'
import { assessJobWithAi } from '../review/index.js'
import { deliveryReviewMode, recordAgentBid, runAgentMarketTick, submitAgentDelivery } from '../domain/index.js'
import { addEvent, fail } from '../domain/utils.js'

export type McpAgentAuth = Extract<AgentAuth, { kind: 'agent' }>

function mcpAllowedOrigin(origin: string): boolean {
  const configured = (process.env.MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (configured.includes('*') || configured.includes(origin)) return true
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function requireMcpOrigin(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  if (!origin) return
  if (!mcpAllowedOrigin(origin)) fail('MCP origin is not allowed', 403)
  res.setHeader('Access-Control-Allow-Origin', origin)
}

function requireMcpAgentAuth(req: http.IncomingMessage): McpAgentAuth {
  const auth = requireAgentAuth(req)
  if (auth.kind !== 'agent') fail('MCP requires a connected worker-agent API key', 403)
  return auth
}

export function mcpAgentJob(job: Job) {
  const review = job.review ? {
    at: job.review.at,
    approved: job.review.approved,
    score: job.review.score,
    source: job.review.source,
    recommendation: job.review.recommendation,
    releaseEligible: job.review.releaseEligible,
    summary: job.review.summary,
    missing: job.review.missing,
    revisionInstructions: job.review.revisionInstructions,
    autoReleaseAt: job.review.autoReleaseAt || '',
    ...(job.review.panel ? { panel: job.review.panel } : {}),
  } : undefined
  return {
    ...agentJob(job),
    ...(job.submission ? { submission: job.submission } : {}),
    ...(review ? { review } : {}),
  }
}

function mcpCanSeeJob(auth: McpAgentAuth, job: Job): boolean {
  if (auth.agent.demoSessionId && job.demoSessionId !== auth.agent.demoSessionId) return false
  return job.status === 'open' || job.marketplace?.awardedBid?.by === auth.agent.name
}

function mcpVisibleJobs(auth: McpAgentAuth) {
  return [...jobs.values()]
    .filter((job) => mcpCanSeeJob(auth, job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(mcpAgentJob)
}

function requireMcpJob(auth: McpAgentAuth, jobId: unknown): Job {
  const id = String(jobId || '').trim()
  if (!id) fail('jobId is required')
  const job = jobs.get(id)
  if (!job) fail('job not found', 404)
  if (!mcpCanSeeJob(auth, job)) fail('job is not visible to this agent', 403)
  return job
}

function mcpResult(summary: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(structuredContent, null, 2)}` }],
    structuredContent,
  }
}

function mcpResource(uri: string, payload: unknown): ReadResourceResult {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2),
    }],
  }
}

function createTxoddsMcpServer(auth: McpAgentAuth, options: HandlerOptions): McpServer {
  const server = new McpServer({
    name: 'txodds-platform',
    version: '0.1.0',
  })

  server.registerTool('txodds_list_jobs', {
    title: 'List TxOdds Jobs',
    description: 'List open jobs and jobs already awarded to the authenticated worker agent.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    if (await runBackendTicks(options)) await saveJobs()
    const visible = mcpVisibleJobs(auth)
    return mcpResult(`Found ${visible.length} visible job(s).`, { jobs: visible })
  })

  server.registerTool('txodds_get_job', {
    title: 'Get TxOdds Job',
    description: 'Read one job if it is open or awarded to the authenticated worker agent.',
    inputSchema: { jobId: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ jobId }) => {
    const job = requireMcpJob(auth, jobId)
    return mcpResult(`Loaded job ${job.id}.`, { job: mcpAgentJob(job) })
  })

  server.registerTool('txodds_bid_job', {
    title: 'Bid On TxOdds Job',
    description: 'Place or replace this worker agent’s bid on an open marketplace job.',
    inputSchema: {
      jobId: z.string().min(1),
      priceSol: z.number().positive(),
      wallet: z.string().optional(),
      note: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ jobId, priceSol, wallet, note }) => {
    const job = requireMcpJob(auth, jobId)
    const bid = recordAgentBid(job, {
      by: auth.agent.name,
      wallet: wallet || auth.agent.wallet,
      priceSol,
      note,
    })
    await saveJobs()
    await saveAgents()
    return mcpResult(`Bid ${bid.priceSol} SOL on ${job.id} as ${auth.agent.name}.`, { bid, job: mcpAgentJob(job) })
  })

  server.registerTool('txodds_submit_delivery', {
    title: 'Submit TxOdds Delivery',
    description: 'Submit a public preview URL, public GitHub repository, or notes for a job awarded to this worker agent. A preview URL is optional when the GitHub repo can be built and inspected.',
    inputSchema: {
      jobId: z.string().min(1),
      url: z.string().optional(),
      repo: z.string().optional(),
      notes: z.string().optional(),
      reviewMode: z.enum(['artifact-ai', 'coral-panel']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ jobId, url, repo, notes, reviewMode }) => {
    const job = requireMcpJob(auth, jobId)
    const submission = submitAgentDelivery(job, { by: auth.agent.name, url, repo, notes, reviewMode })
    if (deliveryReviewMode({ reviewMode }) === 'coral-panel') {
      addEvent(job, 'agent', 'coral_panel_requested', 'Delivery queued for Coral panel review')
    } else {
      await assessJobWithAi(job, options.reviewer, options.collectArtifacts)
    }
    await runAgentMarketTick(options.escrowAdapter)
    await saveJobs()
    await saveAgents()
    return mcpResult(`Submitted delivery evidence for ${job.id}.`, { submission, job: mcpAgentJob(job) })
  })

  server.registerTool('txodds_agent_status', {
    title: 'TxOdds Agent Status',
    description: 'Show the authenticated worker agent profile and visible job counts.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    if (await runBackendTicks(options)) await saveJobs()
    const visible = mcpVisibleJobs(auth)
    return mcpResult(`Agent ${auth.agent.name} is ${auth.agent.status}.`, {
      agent: {
        id: auth.agent.id,
        name: auth.agent.name,
        wallet: auth.agent.wallet || '',
        status: auth.agent.status,
        createdAt: auth.agent.createdAt,
        lastSeenAt: auth.agent.lastSeenAt || '',
      },
      counts: {
        visibleJobs: visible.length,
        openJobs: visible.filter((job) => job.status === 'open').length,
        awardedJobs: visible.filter((job) => job.marketplace?.awardedBid?.by === auth.agent.name).length,
      },
    })
  })

  server.registerResource('txodds-agent-profile', 'txodds://agent/profile', {
    title: 'TxOdds Agent Profile',
    mimeType: 'application/json',
  }, async (uri) => mcpResource(uri.toString(), {
    id: auth.agent.id,
    name: auth.agent.name,
    wallet: auth.agent.wallet || '',
    status: auth.agent.status,
    createdAt: auth.agent.createdAt,
    lastSeenAt: auth.agent.lastSeenAt || '',
  }))

  server.registerResource('txodds-open-jobs', 'txodds://jobs/open', {
    title: 'TxOdds Open Jobs',
    mimeType: 'application/json',
  }, async (uri) => mcpResource(uri.toString(), {
    jobs: mcpVisibleJobs(auth).filter((job) => job.status === 'open'),
  }))

  server.registerResource('txodds-job', new ResourceTemplate('txodds://jobs/{id}', {
    list: async () => ({
      resources: mcpVisibleJobs(auth).map((job) => ({
        uri: `txodds://jobs/${job.id}`,
        name: job.id,
        title: job.title,
        mimeType: 'application/json',
      })),
    }),
  }), {
    title: 'TxOdds Job',
    mimeType: 'application/json',
  }, async (uri, variables) => {
    const job = requireMcpJob(auth, variables.id)
    return mcpResource(uri.toString(), { job: mcpAgentJob(job) })
  })

  server.registerPrompt('txodds_worker_brief', {
    title: 'TxOdds Worker Brief',
    description: 'Instructions for an AI worker agent using the TxOdds marketplace MCP tools.',
  }, async (): Promise<GetPromptResult> => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `You are ${auth.agent.name}, a connected worker agent on the TxOdds freelance escrow platform.`,
          'Use txodds_list_jobs to inspect open work, then txodds_get_job before bidding.',
          'Bid only when the scope, acceptance criteria, budget, and payout wallet are clear.',
          'After award/funding, build the requested artifact and call txodds_submit_delivery with a public GitHub repo, detailed notes, and reviewMode: "coral-panel".',
          'A public preview URL is optional if the GitHub repo has a build script/output the platform can inspect. If your work only runs on your local machine, forward/tunnel the local port to a public URL before submitting it; do not submit 127.0.0.1, localhost, file://, or a local filesystem path because the platform cannot inspect worker-machine-local evidence.',
          'Do not claim to have completed work until delivery evidence is available.',
        ].join('\n'),
      },
    }],
  }))

  return server
}

export async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse, options: HandlerOptions): Promise<void> {
  requireMcpOrigin(req, res)
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }))
    return
  }
  const auth = requireMcpAgentAuth(req)
  await saveAgents()
  const server = createTxoddsMcpServer(auth, options)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res)
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = (e as { status?: number }).status || 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: (e as Error).message || 'Internal server error' },
        id: null,
      }))
    }
  }
}
