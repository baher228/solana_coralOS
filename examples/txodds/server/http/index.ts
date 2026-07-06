import type http from 'node:http'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CORAL_BUS_API, DEMO_SESSION_TTL_MS, PORT, PUBLIC_BASE_URL, REVIEW_DIR, corsOrigin } from '../config.js'
import { createConnectedAgent, hydrateJob, jobs, listConnectedAgents, resetStoresForTest, revokeConnectedAgent, saveAgents, saveJobs } from '../store.js'
import { cleanDemoState, createDemoRunJob, demoSessionJobs, demoStatus, localDemoRunner, localDemoRunnerForSession, mcpDemoStatus, sanitizeDemoStatus, startMcpDemoSession, touchDemoSession } from '../demo/index.js'
import { approveReviewedJob, assessDisputeWithAi, assessJobWithAi, assessJobWithPanel, collectPanelReviewArtifacts, disputeJob, panelReviewRequest, recordPanelOpinions, requestRevisionJob, reviewJob } from '../review/index.js'
import { awardAgentBid, cancelJob, claimJob, completeMilestone, createJob, deliveryReviewMode, recordAgentBid, refundJob, runAgentMarketTick, settleAgentEscrow, submitAgentDelivery, submitJob } from '../domain/index.js'
import { addEvent, fail, now, terminal, walletsWithBalances } from '../domain/utils.js'
import { agentJob, agentVisibleJobs, readJson, requireAgentAuth, send } from './agent.js'
import { runBackendTicks } from './ticks.js'
import type { HandlerOptions } from './types.js'
import { handleMcpRequest, mcpAgentJob, requireMcpOrigin } from '../mcp/index.js'
import type { Job, ReviewArtifact } from '../types.js'

export type { HandlerOptions } from './types.js'

export function reviewArtifacts(job: Job): ReviewArtifact[] {
  const run = job.review?.artifactRun
  return run ? [...run.screenshots, ...run.logs] : []
}

export async function sendArtifact(res: http.ServerResponse, job: Job, artifactId: string) {
  const artifact = reviewArtifacts(job).find((item) => item.id === artifactId)
  if (!artifact) fail('artifact not found', 404)
  const root = path.resolve(REVIEW_DIR)
  const file = path.resolve(REVIEW_DIR, artifact.file)
  if (!file.startsWith(root + path.sep)) fail('artifact path is invalid', 400)
  res.statusCode = 200
  res.setHeader('Content-Type', artifact.mime)
  res.end(await fs.readFile(file))
}

function cookieValue(req: http.IncomingMessage, name: string): string | undefined {
  const raw = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(';') : req.headers.cookie
  return raw?.split(';')
    .map((part) => part.trim())
    .map((part) => part.match(/^([^=]+)=(.*)$/))
    .find((match) => match?.[1] === name)?.[2]
}

function ensureDemoSession(req: http.IncomingMessage, res: http.ServerResponse): string {
  const existing = cookieValue(req, 'txodds_demo_session')
  const sessionId = existing?.match(/^[a-zA-Z0-9_-]{16,80}$/) ? existing : `demo_${randomBytes(18).toString('base64url')}`
  touchDemoSession(sessionId)
  if (sessionId !== existing) {
    const maxAge = Math.max(60, Math.floor(DEMO_SESSION_TTL_MS / 1000))
    const secure = PUBLIC_BASE_URL.startsWith('https://') ? '; Secure' : ''
    res.setHeader('Set-Cookie', `txodds_demo_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
  }
  return sessionId
}

export async function state(demoSessionId?: string) {
  const w = await walletsWithBalances()
  const list = (demoSessionId ? demoSessionJobs(demoSessionId) : [...jobs.values()])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hasDevnetEscrow = list.some((job) => job.settlement.mode === 'devnet-escrow')
  const summary = {
    totalJobs: list.length,
    activeJobs: list.filter((job) => !terminal.has(job.status)).length,
    openJobs: list.filter((job) => job.status === 'open').length,
    claimedJobs: list.filter((job) => !terminal.has(job.status) && job.status !== 'open').length,
    inReview: list.filter((job) => job.status === 'submitted' || job.status === 'revision_requested').length,
    releasedJobs: list.filter((job) => job.status === 'released').length,
    disputedJobs: list.filter((job) => job.status === 'disputed').length,
    lockedSol: Number(list
      .filter((job) => !terminal.has(job.status))
      .reduce((sum, job) => sum + Number(job.amountSol || 0), 0)
      .toFixed(6)),
  }
  return {
    jobs: list,
    agents: listConnectedAgents(demoSessionId),
    summary,
    setup: {
      wallets: w,
      mode: hasDevnetEscrow ? 'devnet-escrow' : 'local-demo',
      note: hasDevnetEscrow
        ? 'Agent-awarded jobs use devnet escrow. Manual demo jobs can still use local escrow state.'
        : w.configured
          ? 'Devnet wallets are configured. Manual jobs still use local-demo escrow until an agent awards a job.'
          : 'No local wallets are configured. The platform still runs in local-demo escrow mode.',
    },
  }
}

export function resetJobsForTest(): void {
  resetStoresForTest()
}

export async function resetCoralBusForDemo(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    await fetch(`${CORAL_BUS_API}/reset`, { method: 'POST', signal: controller.signal })
  } catch {
    // Local demo reset should still work when the optional Coral bus is offline.
  } finally {
    clearTimeout(timeout)
  }
}

export function createHandler(options: HandlerOptions = {}): http.RequestListener {
  return async (req, res) => {
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
    const allowedOrigin = corsOrigin(origin)
    if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    if (allowedOrigin && allowedOrigin !== '*') res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

    try {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`)
      if (req.method === 'OPTIONS') {
        if (url.pathname === '/mcp') requireMcpOrigin(req, res)
        return send(res, 204, {})
      }
      const demoRoute = url.pathname.startsWith('/api/demo/')
      const demoSessionId = demoRoute ? ensureDemoSession(req, res) : undefined
      const demoRunner = options.demoRunner || (demoSessionId ? localDemoRunnerForSession(demoSessionId) : localDemoRunner)
      const agentRoute = url.pathname.match(/^\/api\/agent\/jobs(?:\/([^/]+)\/(bids|award|delivery|artifacts|panel-opinions|panel-review|settle))?$/)
      const agentsRoute = url.pathname.match(/^\/api\/agents(?:\/([^/]+)\/(revoke))?$/)
      const route = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(claim|messages|submission|review|dispute|refund|cancel)$/)
      const disputeReviewRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/dispute\/review$/)
      const milestoneRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/milestones\/([^/]+)\/complete$/)
      const artifactRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\/([^/]+)$/)

      if (req.method === 'GET' && url.pathname === '/api/coral/health') {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 1500)
        try {
          const upstream = await fetch(`${CORAL_BUS_API}/health`, { signal: controller.signal })
          const body = await upstream.json().catch(() => ({}))
          return send(res, upstream.ok ? 200 : 502, body)
        } finally {
          clearTimeout(timeout)
        }
      }

      if (url.pathname === '/mcp') return await handleMcpRequest(req, res, options)

      if (req.method === 'GET' && url.pathname === '/api/demo/platform' && demoSessionId) {
        if (await runBackendTicks(options)) await saveJobs()
        return send(res, 200, await state(demoSessionId))
      }

      if (req.method === 'POST' && url.pathname === '/api/demo/jobs' && demoSessionId) {
        const createdJob = createDemoRunJob(await readJson(req), demoSessionId)
        await saveJobs()
        return send(res, 201, { ...(await state(demoSessionId)), createdJob })
      }

      if (url.pathname === '/api/demo/reset') {
        if (req.method === 'POST') {
          cleanDemoState(demoSessionId)
          if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(PUBLIC_BASE_URL)) await resetCoralBusForDemo()
          await saveJobs()
          await saveAgents()
          return send(res, 200, { ...(await state(demoSessionId)), demo: demoStatus(demoSessionId), mcp: mcpDemoStatus(false, demoSessionId) })
        }
        return send(res, 404, { error: 'not found' })
      }

      if (url.pathname === '/api/demo/mcp-session') {
        if (req.method === 'GET') return send(res, 200, mcpDemoStatus(false, demoSessionId))
        if (req.method === 'POST') return send(res, 200, await startMcpDemoSession(await readJson(req), demoSessionId))
        return send(res, 404, { error: 'not found' })
      }

      if (url.pathname === '/api/demo/agent-run') {
        if (req.method === 'GET') return send(res, 200, sanitizeDemoStatus(await demoRunner.status()))
        if (req.method === 'POST') return send(res, 200, sanitizeDemoStatus(await demoRunner.start(await readJson(req))))
        return send(res, 404, { error: 'not found' })
      }

      if (req.method === 'GET' && url.pathname === '/api/agents') {
        return send(res, 200, { agents: listConnectedAgents() })
      }
      if (req.method === 'POST' && url.pathname === '/api/agents') {
        const created = createConnectedAgent(await readJson(req))
        await saveAgents()
        return send(res, 201, {
          ...created,
          env: [
            'AGENT_TRANSPORT=api',
            `AGENT_API_BASE=${PUBLIC_BASE_URL}`,
            `AGENT_API_TOKEN=${created.token}`,
            `AGENT_NAME=${created.agent.name}`,
            created.agent.wallet ? `DEMO_WORKER_WALLET=${created.agent.wallet}` : '',
          ].filter(Boolean).join('\n'),
        })
      }
      if (req.method === 'POST' && agentsRoute?.[1] && agentsRoute[2] === 'revoke') {
        const agent = revokeConnectedAgent(agentsRoute[1])
        await saveAgents()
        return send(res, 200, { agent })
      }

      if (url.pathname.startsWith('/api/agent/')) {
        const auth = requireAgentAuth(req)
        let changed = auth.kind === 'agent' ? 1 : 0
        if (req.method === 'GET' && agentRoute && !agentRoute[1]) {
          changed += await runBackendTicks(options)
          if (changed) {
            await saveJobs()
            await saveAgents()
          }
          return send(res, 200, agentVisibleJobs(auth))
        }
        if (req.method === 'POST' && agentRoute?.[1] && agentRoute[2]) {
          const [, id, action] = agentRoute
          const job = jobs.get(id)
          if (!job) fail('job not found', 404)
          if (auth.kind === 'agent' && auth.agent.demoSessionId && job.demoSessionId !== auth.agent.demoSessionId) fail('job not found', 404)
          const body = await readJson(req)
          if (action === 'bids') {
            const bid = recordAgentBid(job, auth.kind === 'agent'
              ? { ...body, by: auth.agent.name, wallet: body.wallet || auth.agent.wallet }
              : body)
            await saveJobs()
            if (auth.kind === 'agent') await saveAgents()
            return send(res, 200, { bid, job: agentJob(job) })
          }
          if (action === 'award') {
            if (auth.kind !== 'platform') fail('only the platform can award bids', 403)
            const bid = await awardAgentBid(job, body, options.escrowAdapter)
            await saveJobs()
            return send(res, 200, { bid, job: agentJob(job) })
          }
          if (action === 'delivery') {
            const submission = submitAgentDelivery(job, auth.kind === 'agent' ? { ...body, by: auth.agent.name } : body)
            if (deliveryReviewMode(body) === 'coral-panel') {
              addEvent(job, 'agent', 'coral_panel_requested', 'Delivery queued for Coral panel review')
            } else if (!(auth.kind === 'platform' && body.deferReview === true)) {
              await assessJobWithAi(job, options.reviewer, options.collectArtifacts)
            }
            await runAgentMarketTick(options.escrowAdapter)
            await saveJobs()
            if (auth.kind === 'agent') await saveAgents()
            return send(res, 200, { submission, job: agentJob(job) })
          }
          if (action === 'artifacts') {
            if (auth.kind !== 'platform') fail('only the platform can collect panel review artifacts', 403)
            const review = await collectPanelReviewArtifacts(job, body, options.collectArtifacts)
            await saveJobs()
            return send(res, 200, { review, request: panelReviewRequest(job), job: mcpAgentJob(job) })
          }
          if (action === 'panel-review') {
            if (auth.kind !== 'platform') fail('only the platform can submit panel review verdicts', 403)
            const review = assessJobWithPanel(job, body)
            await runAgentMarketTick(options.escrowAdapter)
            await saveJobs()
            return send(res, 200, { review, job: mcpAgentJob(job) })
          }
          if (action === 'panel-opinions') {
            if (auth.kind !== 'platform') fail('only the platform can submit panel advocate opinions', 403)
            const review = recordPanelOpinions(job, body)
            await saveJobs()
            return send(res, 200, { review, job: mcpAgentJob(job) })
          }
          if (action === 'settle') {
            if (auth.kind !== 'platform') fail('only the platform can settle escrows', 403)
            const result = await settleAgentEscrow(job, options.escrowAdapter)
            await saveJobs()
            return send(res, 200, { settled: result, job: agentJob(job) })
          }
        }
        return send(res, 404, { error: 'not found' })
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, product: 'freelance-escrow-platform', ...(await state()).setup })
      }
      if (req.method === 'GET' && artifactRoute) {
        const [, id, artifactId] = artifactRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        return await sendArtifact(res, job, artifactId)
      }
      if (req.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/api/platform')) {
        if (await runBackendTicks(options)) await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        return send(res, 200, { exportedAt: now(), ...(await state()) })
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const body = await readJson(req)
        if (!Array.isArray(body.jobs)) fail('import requires a jobs array')
        const imported = body.jobs.map(hydrateJob).filter((job): job is Job => Boolean(job))
        jobs.clear()
        for (const job of imported) jobs.set(job.id, job)
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const createdJob = createJob(await readJson(req))
        await saveJobs()
        return send(res, 201, { ...(await state()), createdJob })
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/seed') {
        jobs.clear()
        const job = createJob({
          title: 'Build a landing page checkout section',
          employer: 'Northstar Studio',
          worker: 'Checkout Guild',
          scope: 'Responsive checkout section with pricing, accessible buttons, deployment notes, and mobile proof.',
          acceptanceCriteria: 'Includes preview URL, repo link, mobile screenshot evidence, pricing copy, and notes for each acceptance item.',
          amountSol: 0.001,
          milestones: [
            'Checkout layout and pricing copy',
            'Accessible buttons and responsive states',
            'Preview URL, repo link, and deployment notes',
          ],
        })
        job.messages.push({ at: now(), author: 'employer', text: 'Please include mobile screenshots and the repo.' })
        addEvent(job, 'system', 'seeded', 'Platform sample job seeded')
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && url.pathname === '/api/state/reset') {
        jobs.clear()
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && milestoneRoute) {
        const [, id, milestoneId] = milestoneRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        const body = await readJson(req)
        completeMilestone(job, milestoneId, body.actor === 'employer' ? 'employer' : 'worker')
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && disputeReviewRoute) {
        const [, id] = disputeReviewRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        await readJson(req)
        await assessDisputeWithAi(job)
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && route) {
        const [, id, action] = route
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        const body = await readJson(req)
        if (action === 'claim') {
          claimJob(job, body)
        } else if (action === 'messages') {
          const author = body.author === 'worker' ? 'worker' : body.author === 'agent' ? 'agent' : 'employer'
          const text = String(body.text || '').trim()
          if (!text) fail('message text is required')
          if (job.status === 'open' && author !== 'employer') fail('cannot message as worker before task is claimed', 409)
          job.messages.push({ at: now(), author, text })
          addEvent(job, author, 'message', text.slice(0, 80))
        } else if (action === 'submission') {
          submitJob(job, body)
        } else if (action === 'review') {
          if (!body.action) {
            reviewJob(job)
          } else if (body.action === 'assess') {
            await assessJobWithAi(job)
          } else if (body.action === 'assess_dispute') {
            await assessDisputeWithAi(job)
          } else if (body.action === 'approve') {
            approveReviewedJob(job, body)
          } else if (body.action === 'request_revision') {
            requestRevisionJob(job, body)
          } else {
            fail('unknown review action')
          }
        } else if (action === 'dispute') {
          disputeJob(job, body)
        } else if (action === 'refund') {
          refundJob(job)
        } else if (action === 'cancel') {
          cancelJob(job)
        }
        await saveJobs()
        return send(res, 200, await state())
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, (e as { status?: number }).status || 500, { error: (e as Error).message })
    }
  }
}
