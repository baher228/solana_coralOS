import http from 'node:http'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approveReviewedJob,
  awardAgentBid,
  assessDisputeWithAi,
  assessJobWithAi,
  autoReleaseExpiredJobs,
  cancelJob,
  claimJob,
  collectPanelReviewArtifacts,
  completeMilestone,
  createHandler,
  createJob,
  disputeJob,
  refundJob,
  recordAgentBid,
  recordPanelOpinions,
  requestRevisionJob,
  resetJobsForTest,
  reviewJob,
  runAgentMarketTick,
  assessJobWithPanel,
  settleAgentEscrow,
  submitAgentDelivery,
  submitJob,
  type DemoRunStatus,
  type DevnetEscrowAdapter,
} from './proxy.js'

afterEach(() => resetJobsForTest())

function withBuyerKey() {
  const previous = process.env.BUYER_KEYPAIR_B58
  process.env.BUYER_KEYPAIR_B58 = bs58.encode(Keypair.generate().secretKey)
  return () => {
    if (previous == null) delete process.env.BUYER_KEYPAIR_B58
    else process.env.BUYER_KEYPAIR_B58 = previous
  }
}

function fakeEscrow(): DevnetEscrowAdapter {
  return {
    async deposit() { return 'sig-deposit' },
    async release() { return 'sig-release' },
    async refund() { return 'sig-refund' },
  }
}

async function request(handler: http.RequestListener, path: string, init: RequestInit = {}) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init)
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function withMcpClient<T>(handler: http.RequestListener, token: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'txodds-test-client', version: '1.0.0' }, { capabilities: {} })
  try {
    await client.connect(transport)
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function json(body: Record<string, unknown>, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }
}

function mcpJson(body: Record<string, unknown>, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }
}

function mcpInitialize(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'txodds-test-client', version: '1.0.0' },
    },
  }
}

function demoRunStatus(overrides: Partial<DemoRunStatus> & Record<string, unknown> = {}): DemoRunStatus & Record<string, unknown> {
  return {
    running: false,
    agentName: 'demo-worker-live',
    logs: [],
    steps: {
      agentStarted: false,
      jobPosted: false,
      bidPlaced: false,
      awarded: false,
      funded: false,
      buildServed: false,
      deliverySubmitted: false,
      reviewCaptured: false,
    },
    ...overrides,
  }
}

function platformJob() {
  return createJob({
    title: 'Build checkout',
    employer: 'Northstar Studio',
    worker: 'Checkout Guild',
    scope: 'Responsive checkout with pricing and accessible buttons',
    acceptanceCriteria: 'Preview URL, repo link, mobile proof, and deployment notes',
    amountSol: 0.003,
    milestones: ['Layout', 'Responsive states', 'Delivery proof'],
  })
}

function openTask() {
  return createJob({
    title: 'Build marketplace task',
    employer: 'Northstar Studio',
    marketplace: true,
    scope: 'Responsive marketplace task card with budget, scope, and mobile proof',
    acceptanceCriteria: 'Includes preview URL, repo link, mobile proof, and notes for each acceptance item',
    amountSol: 0.003,
    milestones: ['Task card', 'Responsive states', 'Delivery proof'],
  })
}

function submittedTask(notes = 'Responsive marketplace task card with budget, scope, mobile proof, preview URL, and repo link.') {
  const job = openTask()
  claimJob(job, { worker: 'Checkout Guild' })
  submitJob(job, {
    url: 'https://example.test/preview',
    repo: 'https://example.test/repo',
    notes,
  })
  return job
}

function aiReply(input: Record<string, unknown>) {
  return async () => JSON.stringify(input)
}

function artifactRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'review_test',
    at: new Date().toISOString(),
    repo: { status: 'pass', summary: 'Repository cloned and scanned', url: 'https://github.com/example/repo', commit: 'abc123', packageManager: 'npm', scripts: { build: 'vite build' }, files: [] },
    build: { status: 'pass', summary: 'Build completed', command: 'npm run build', outputDir: 'dist' },
    tests: { status: 'skipped', summary: 'No package test script found' },
    preview: { status: 'pass', summary: 'Preview URL loaded', url: 'https://example.test/preview', httpStatus: 200 },
    screenshots: [
      { id: 'shot_desktop', kind: 'screenshot', label: 'preview desktop', file: 'job/review/desktop.png', mime: 'image/png' },
      { id: 'shot_mobile', kind: 'screenshot', label: 'preview mobile', file: 'job/review/mobile.png', mime: 'image/png' },
    ],
    logs: [],
    ...overrides,
  } as any
}

function collectArtifacts(run = artifactRun()) {
  return async () => run
}

function aiApprove(extra: Record<string, unknown> = {}) {
  return aiReply({
    score: 92,
    recommendation: 'approve',
    confidence: 88,
    summary: 'Evidence satisfies the task.',
    criteriaResults: [
      { label: 'Preview URL', status: 'pass', reason: 'Preview loaded and screenshots were captured.', evidence: 'preview desktop/mobile screenshots' },
      { label: 'Mobile proof', status: 'pass', reason: 'Mobile screenshot shows responsive layout.', evidence: 'preview mobile screenshot' },
    ],
    missing: [],
    risks: [],
    criticalRisks: [],
    revisionInstructions: '',
    ...extra,
  })
}

function panelApprove(extra: Record<string, unknown> = {}) {
  return {
    threadId: 'review-thread',
    opinions: [
      { role: 'worker', agent: 'worker-advocate', summary: 'Artifacts support release.', recommendation: 'approve', concerns: [], evidence: ['preview', 'screenshots'] },
      { role: 'employer', agent: 'employer-advocate', summary: 'No material acceptance gap found.', recommendation: 'approve', concerns: [], evidence: ['build', 'screenshots'] },
    ],
    verdict: {
      score: 91,
      recommendation: 'approve',
      confidence: 86,
      summary: 'Coral panel finds the work release eligible.',
      criteriaResults: [
        { label: 'Preview URL', status: 'pass', reason: 'Preview loaded.', evidence: 'preview screenshot' },
        { label: 'Mobile proof', status: 'pass', reason: 'Mobile screenshot shows responsive work.', evidence: 'mobile screenshot' },
      ],
      missing: [],
      risks: [],
      criticalRisks: [],
      revisionInstructions: '',
      ...extra,
    },
  }
}

describe('freelance escrow platform flow', () => {
  it('keeps legacy job creation funded when a worker is supplied', () => {
    const job = platformJob()
    expect(job.employer).toBe('Northstar Studio')
    expect(job.worker).toBe('Checkout Guild')
    expect(job.status).toBe('funded')
    expect(job.scope).toContain('Responsive checkout')
    expect(job.milestones).toHaveLength(3)
    expect(job.settlement.events[0].type).toBe('funded')
  })

  it('keeps the old demo POST shape funded without requiring a worker field', () => {
    const job = createJob({
      title: 'Legacy demo task',
      requirements: 'Write concise API documentation for auth, errors, pagination, and retries',
      acceptanceCriteria: 'Includes curl examples, setup notes, and a repo or public URL',
      amountSol: 0.002,
    })

    expect(job.status).toBe('funded')
    expect(job.worker).toBeTruthy()
  })

  it('creates an open marketplace task without a worker', () => {
    const job = openTask()

    expect(job.status).toBe('open')
    expect(job.worker).toBe('')
    expect(job.settlement.events).toHaveLength(0)
    expect(job.events[0].type).toBe('posted')
  })

  it('lets one worker claim an open task and blocks duplicate claims', () => {
    const job = openTask()

    claimJob(job, { worker: 'Checkout Guild' })

    expect(job.status).toBe('funded')
    expect(job.worker).toBe('Checkout Guild')
    expect(job.settlement.events[0].type).toBe('funded')
    expect(() => claimJob(job, { worker: 'Second Studio' })).toThrow(/cannot claim while job is funded/)
  })

  it('requires an agent API token for agent routes', async () => {
    const oldToken = process.env.AGENT_API_TOKEN
    try {
      delete process.env.AGENT_API_TOKEN
      expect((await request(createHandler(), '/api/agent/jobs')).status).toBe(503)

      process.env.AGENT_API_TOKEN = 'secret'
      expect((await request(createHandler(), '/api/agent/jobs')).status).toBe(401)
      expect((await request(createHandler(), '/api/agent/jobs', { headers: { Authorization: 'Bearer secret' } })).status).toBe(200)
    } finally {
      if (oldToken == null) delete process.env.AGENT_API_TOKEN
      else process.env.AGENT_API_TOKEN = oldToken
    }
  })

  it('creates, tracks, and revokes direct agent tokens', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()

    const created = await request(handler, '/api/agents', json({ name: 'demo-worker', wallet }))
    expect(created.status).toBe(201)
    expect(created.body.token).toMatch(/^agt_/)
    expect(created.body.agent.tokenHash).toBeUndefined()
    expect(created.body.env).toContain('AGENT_TRANSPORT=api')

    expect((await request(handler, '/api/agent/jobs', { headers: { Authorization: `Bearer ${created.body.token}` } })).status).toBe(200)
    const listed = await request(handler, '/api/agents')
    expect(listed.body.agents[0].lastSeenAt).toBeTruthy()

    const revoked = await request(handler, `/api/agents/${created.body.agent.id}/revoke`, json({}))
    expect(revoked.status).toBe(200)
    expect((await request(handler, '/api/agent/jobs', { headers: { Authorization: `Bearer ${created.body.token}` } })).status).toBe(401)
  })

  it('rejects missing, revoked, and cross-origin MCP API keys', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()
    const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))
    const token = created.body.token

    expect((await request(handler, '/mcp', mcpJson(mcpInitialize()))).status).toBe(401)

    const blocked = await request(handler, '/mcp', {
      ...mcpJson(mcpInitialize(2), token),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        Origin: 'https://evil.test',
      },
    })
    expect(blocked.status).toBe(403)

    await request(handler, `/api/agents/${created.body.agent.id}/revoke`, json({}))
    expect((await request(handler, '/mcp', mcpJson(mcpInitialize(3), token))).status).toBe(401)
  })

  it('lists only worker MCP tools', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()
    const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))

    await withMcpClient(handler, created.body.token, async (client) => {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'txodds_agent_status',
        'txodds_bid_job',
        'txodds_get_job',
        'txodds_list_jobs',
        'txodds_submit_delivery',
      ])
    })
  })

  it('keeps MCP job visibility scoped to open and awarded jobs', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const wallet = Keypair.generate().publicKey.toBase58()
      const otherWallet = Keypair.generate().publicKey.toBase58()
      const handler = createHandler({ escrowAdapter: fakeEscrow() })
      const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))
      const open = openTask()
      const own = openTask()
      const hidden = openTask()
      recordAgentBid(own, { by: 'mcp-worker', wallet, priceSol: 0.001 })
      recordAgentBid(hidden, { by: 'other-agent', wallet: otherWallet, priceSol: 0.001 })
      await awardAgentBid(own, { by: 'mcp-worker' }, fakeEscrow())
      await awardAgentBid(hidden, { by: 'other-agent' }, fakeEscrow())

      await withMcpClient(handler, created.body.token, async (client) => {
        const result = await client.callTool({ name: 'txodds_list_jobs', arguments: {} })
        const ids = ((result.structuredContent as { jobs: Array<{ id: string }> }).jobs).map((job) => job.id)
        expect(ids).toContain(open.id)
        expect(ids).toContain(own.id)
        expect(ids).not.toContain(hidden.id)
      })
    } finally {
      restoreBuyer()
    }
  })

  it('lets MCP agents bid as themselves without leaking API keys', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()
    const created = await request(handler, '/api/agents', json({ name: 'mcp-bidder', wallet }))
    const job = openTask()

    await withMcpClient(handler, created.body.token, async (client) => {
      const result = await client.callTool({
        name: 'txodds_bid_job',
        arguments: { jobId: job.id, priceSol: 0.001, note: 'ready to build' },
      })
      expect(job.marketplace?.bids[0].by).toBe('mcp-bidder')
      expect(job.marketplace?.bids[0].wallet).toBe(wallet)
      const text = JSON.stringify(result)
      expect(text).not.toContain(created.body.token)
      expect(text).not.toContain('tokenHash')
      expect(text).not.toContain('SELLER_KEYPAIR')
      expect(text).not.toContain('BUYER_KEYPAIR')
    })
  })

  it('rejects MCP delivery from an agent that has not been awarded', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()
    const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))
    const job = openTask()

    await withMcpClient(handler, created.body.token, async (client) => {
      const result = await client.callTool({
        name: 'txodds_submit_delivery',
        arguments: { jobId: job.id, notes: 'Preview is ready for review.' },
      })
      expect(result.isError).toBe(true)
    })
  })

  it('lets an awarded MCP agent submit delivery and trigger review', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const wallet = Keypair.generate().publicKey.toBase58()
      const job = openTask()
      const handler = createHandler({ escrowAdapter: fakeEscrow(), reviewer: aiApprove(), collectArtifacts: collectArtifacts() })
      const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))
      recordAgentBid(job, { by: 'mcp-worker', wallet, priceSol: 0.001 })
      await awardAgentBid(job, { by: 'mcp-worker' }, fakeEscrow())

      await withMcpClient(handler, created.body.token, async (client) => {
        const result = await client.callTool({
          name: 'txodds_submit_delivery',
          arguments: {
            jobId: job.id,
            url: 'https://example.test/preview',
            notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, preview URL, and delivery notes.',
          },
        })
        expect(job.submission?.url).toBe('https://example.test/preview')
        expect(job.review?.source).toBe('ai')
        expect(job.review?.releaseEligible).toBe(true)
        const structured = result.structuredContent as { job: { review?: { releaseEligible?: boolean } } }
        expect(structured.job.review?.releaseEligible).toBe(true)
      })
    } finally {
      restoreBuyer()
    }
  })

  it('lets an awarded MCP agent queue delivery for Coral panel review', async () => {
    const restoreBuyer = withBuyerKey()
    const oldToken = process.env.AGENT_API_TOKEN
    try {
      process.env.AGENT_API_TOKEN = 'platform-secret'
      const wallet = Keypair.generate().publicKey.toBase58()
      const job = openTask()
      const handler = createHandler({ escrowAdapter: fakeEscrow(), reviewer: aiApprove(), collectArtifacts: collectArtifacts() })
      const created = await request(handler, '/api/agents', json({ name: 'mcp-worker', wallet }))
      recordAgentBid(job, { by: 'mcp-worker', wallet, priceSol: 0.001 })
      await awardAgentBid(job, { by: 'mcp-worker' }, fakeEscrow())

      await withMcpClient(handler, created.body.token, async (client) => {
        const result = await client.callTool({
          name: 'txodds_submit_delivery',
          arguments: {
            jobId: job.id,
            url: 'https://example.test/preview',
            notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, preview URL, and delivery notes.',
            reviewMode: 'coral-panel',
          },
        })
        expect(job.submission?.url).toBe('https://example.test/preview')
        expect(job.review).toBeUndefined()
        expect(JSON.stringify(result.structuredContent)).not.toContain('releaseEligible')
      })

      const platform = await request(handler, '/api/agent/jobs', { headers: { Authorization: 'Bearer platform-secret' } })
      expect(platform.body.reviews.map((item: { id: string }) => item.id)).toContain(job.id)
    } finally {
      if (oldToken == null) delete process.env.AGENT_API_TOKEN
      else process.env.AGENT_API_TOKEN = oldToken
      restoreBuyer()
    }
  })

  it('starts an MCP demo session and tracks real MCP activity safely', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()

    const started = await request(handler, '/api/demo/mcp-session', json({
      wallet,
      title: 'Custom agent checkout',
      employer: 'OpenClaw Studio',
      scope: 'Build a checkout page from the custom demo form and submit delivery evidence.',
      acceptanceCriteria: 'Includes preview URL, responsive layout proof, repo link, and notes for every acceptance item.',
      amountSol: 0.002,
    }))
    expect(started.status).toBe(200)
    expect(started.body.token).toMatch(/^agt_/)
    expect(started.body.setup).toContain('/mcp')
    expect(started.body.jobId).toMatch(/^job_/)
    expect(started.body.steps.registered).toBe(true)
    expect(started.body.steps.jobPosted).toBe(true)
    const platform = await request(handler, '/api/platform')
    const job = platform.body.jobs.find((item: { id: string }) => item.id === started.body.jobId)
    expect(job.title).toBe('Custom agent checkout')
    expect(job.employer).toBe('OpenClaw Studio')
    expect(job.marketplace.budgetSol).toBe(0.002)

    const safeStatus = await request(handler, '/api/demo/mcp-session')
    expect(safeStatus.status).toBe(200)
    expect(JSON.stringify(safeStatus.body)).not.toContain(started.body.token)
    expect(JSON.stringify(safeStatus.body)).not.toContain('tokenHash')

    await withMcpClient(handler, started.body.token, async (client) => {
      await client.callTool({
        name: 'txodds_bid_job',
        arguments: { jobId: started.body.jobId, priceSol: 0.001, wallet },
      })
    })

    const afterMcp = await request(handler, '/api/demo/mcp-session')
    expect(afterMcp.body.steps.connected).toBe(true)
    expect(afterMcp.body.steps.bidPlaced).toBe(true)
    expect(afterMcp.body.lastSeenAt).toBeTruthy()
  })

  it('cleans demo jobs and revokes demo MCP sessions', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler()
    openTask()
    const started = await request(handler, '/api/demo/mcp-session', json({ wallet }))
    expect(started.body.token).toMatch(/^agt_/)

    const reset = await request(handler, '/api/demo/reset', json({}))
    expect(reset.status).toBe(200)
    expect(reset.body.jobs).toHaveLength(0)
    expect(reset.body.mcp.active).toBe(false)
    expect(JSON.stringify(reset.body)).not.toContain(started.body.token)
    expect((await request(handler, '/api/agent/jobs', { headers: { Authorization: `Bearer ${started.body.token}` } })).status).toBe(401)
  })

  it('starts the local demo runner without exposing agent secrets', async () => {
    let starts = 0
    const handler = createHandler({
      demoRunner: {
        async start(input) {
          starts += 1
          expect(input?.restart).toBe(true)
          return demoRunStatus({
            running: true,
            pid: 123,
            jobId: 'job_demo',
            previewUrl: 'http://127.0.0.1:4177/',
            logs: ['AGENT_API_TOKEN=agt_super_secret', 'started worker'],
            steps: {
              agentStarted: true,
              jobPosted: true,
              bidPlaced: false,
              awarded: false,
              funded: false,
              buildServed: true,
              deliverySubmitted: false,
              reviewCaptured: false,
            },
            token: 'agt_super_secret',
            env: 'AGENT_API_TOKEN=agt_super_secret',
          })
        },
        async status() {
          return demoRunStatus({ logs: ['agt_super_secret'] })
        },
      },
    })

    const started = await request(handler, '/api/demo/agent-run', json({ restart: true }))
    expect(started.status).toBe(200)
    expect(started.body.running).toBe(true)
    expect(started.body.previewUrl).toBe('http://127.0.0.1:4177/')
    expect(starts).toBe(1)
    const text = JSON.stringify(started.body)
    expect(text).not.toContain('agt_super_secret')
    expect(text).not.toContain('token')
    expect(text).not.toContain('env')

    const status = await request(handler, '/api/demo/agent-run')
    expect(status.status).toBe(200)
    expect(JSON.stringify(status.body)).not.toContain('agt_super_secret')
  })

  it('lets direct agents bid as themselves but not award or settle', async () => {
    const job = openTask()
    const wallet = Keypair.generate().publicKey.toBase58()
    const handler = createHandler({ escrowAdapter: fakeEscrow() })
    const created = await request(handler, '/api/agents', json({ name: 'demo-worker', wallet }))
    const token = created.body.token

    const bid = await request(handler, `/api/agent/jobs/${job.id}/bids`, json({ priceSol: 0.001 }, token))
    expect(bid.status).toBe(200)
    expect(bid.body.bid.by).toBe('demo-worker')
    expect(bid.body.bid.wallet).toBe(wallet)
    expect(job.marketplace?.bidWindowEndsAt).toBeTruthy()

    expect((await request(handler, `/api/agent/jobs/${job.id}/award`, json({}, token))).status).toBe(403)
    expect((await request(handler, `/api/agent/jobs/${job.id}/settle`, json({}, token))).status).toBe(403)
  })

  it('records valid agent bids and blocks invalid award conditions', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      const wallet = Keypair.generate().publicKey.toBase58()

      expect(() => recordAgentBid(job, { by: 'agent-expensive', wallet, priceSol: 0.004 })).toThrow(/budget/)
      expect(() => recordAgentBid(job, { by: 'agent-invalid', wallet: 'nope', priceSol: 0.001 })).toThrow(/wallet/)

      recordAgentBid(job, { by: 'agent-premium', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.0025 })
      recordAgentBid(job, { by: 'agent-cheap', wallet, priceSol: 0.0015 })

      const winner = await awardAgentBid(job, {}, fakeEscrow())

      expect(winner.by).toBe('agent-cheap')
      expect(job.worker).toBe('agent-cheap')
      expect(job.amountSol).toBe(0.0015)
      expect(job.settlement.mode).toBe('devnet-escrow')
      expect(job.settlement.devnet?.deposit).toBe('sig-deposit')
      await expect(awardAgentBid(job, {}, fakeEscrow())).rejects.toThrow(/cannot award/)
    } finally {
      restoreBuyer()
    }
  })

  it('auto-awards the cheapest valid bid after the bid window', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      let deposits = 0
      const escrow = fakeEscrow()
      const countingEscrow: DevnetEscrowAdapter = {
        ...escrow,
        async deposit(input) {
          deposits += 1
          return escrow.deposit(input)
        },
      }
      recordAgentBid(job, { by: 'premium-agent', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.002 })
      recordAgentBid(job, { by: 'cheap-agent', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.001 })

      expect(await runAgentMarketTick(countingEscrow, new Date(Date.now() + 60_000))).toBe(1)
      expect(job.marketplace?.awardedBid?.by).toBe('cheap-agent')
      expect(job.settlement.mode).toBe('devnet-escrow')
      expect(deposits).toBe(1)
      expect(await runAgentMarketTick(countingEscrow, new Date(Date.now() + 120_000))).toBe(0)
      expect(deposits).toBe(1)
    } finally {
      restoreBuyer()
    }
  })

  it('blocks delivery, settlement, refund, and worker dispute actions before claim', () => {
    const job = openTask()

    expect(() => submitJob(job, { notes: 'early evidence' })).toThrow(/cannot submit evidence/)
    expect(() => completeMilestone(job, job.milestones[0].id)).toThrow(/cannot complete milestones/)
    expect(() => reviewJob(job)).toThrow(/cannot review/)
    expect(() => disputeJob(job, { by: 'worker', note: 'before claim' })).toThrow(/cannot dispute/)
    expect(() => refundJob(job)).toThrow(/cannot refund/)

    cancelJob(job)

    expect(job.status).toBe('cancelled')
    expect(() => claimJob(job, { worker: 'Checkout Guild' })).toThrow(/cannot claim a cancelled job/)
  })

  it('submits evidence, completes milestones, and releases after sufficient review', () => {
    const job = openTask()
    claimJob(job, { worker: 'Checkout Guild' })
    completeMilestone(job, job.milestones[0].id)
    submitJob(job, {
      url: 'https://example.test/preview',
      repo: 'https://example.test/repo',
      notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
    })

    const review = reviewJob(job)

    expect(review.approved).toBe(true)
    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
    expect(job.milestones.every((m) => m.status === 'complete')).toBe(true)
  })

  it('stores artifact AI approval without auto-releasing until employer approves', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts())

    expect(review.source).toBe('ai')
    expect(review.approved).toBe(true)
    expect(review.releaseEligible).toBe(true)
    expect(review.artifactRun?.screenshots).toHaveLength(2)
    expect(job.status).toBe('submitted')
    expect(job.settlement.release).toBeUndefined()

    approveReviewedJob(job)

    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
  })

  it('runs open job -> agent bid -> devnet delivery -> review -> release', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      recordAgentBid(job, { by: 'build-agent', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.002 })
      await awardAgentBid(job, {}, fakeEscrow())

      submitAgentDelivery(job, {
        by: 'build-agent',
        url: 'https://example.test/preview',
        repo: 'https://example.test/repo',
        notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
      })
      const review = await assessJobWithAi(job, aiApprove(), collectArtifacts())
      review.autoReleaseAt = new Date(Date.now() - 1000).toISOString()

      expect(await settleAgentEscrow(job, fakeEscrow(), new Date())).toBe('released')
      expect(job.status).toBe('released')
      expect(job.settlement.release).toBe('sig-release')
      expect(job.settlement.devnet?.release).toBe('sig-release')
    } finally {
      restoreBuyer()
    }
  })

  it('stores Coral panel approval and enables devnet settlement', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      recordAgentBid(job, { by: 'panel-worker', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.002 })
      await awardAgentBid(job, {}, fakeEscrow())
      submitAgentDelivery(job, {
        by: 'panel-worker',
        url: 'https://example.test/preview',
        repo: 'https://example.test/repo',
        notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, preview URL, and delivery notes.',
      })
      await collectPanelReviewArtifacts(job, { threadId: 'thread-panel' }, collectArtifacts())

      const review = assessJobWithPanel(job, panelApprove())
      review.autoReleaseAt = new Date(Date.now() - 1000).toISOString()

      expect(review.source).toBe('coral-panel')
      expect(review.panel?.opinions).toHaveLength(2)
      expect(review.releaseEligible).toBe(true)
      expect(await settleAgentEscrow(job, fakeEscrow(), new Date())).toBe('released')
      expect(job.settlement.devnet?.release).toBe('sig-release')
    } finally {
      restoreBuyer()
    }
  })

  it('stores Coral advocate opinions before referee verdict', async () => {
    const job = submittedTask()
    await collectPanelReviewArtifacts(job, { threadId: 'thread-panel' }, collectArtifacts())

    const review = recordPanelOpinions(job, {
      threadId: 'thread-panel',
      opinions: [
        { role: 'worker', agent: 'worker-advocate', summary: 'Preview, build, and screenshots support release.', recommendation: 'approve', evidence: ['preview', 'screenshots'] },
      ],
    })

    expect(review.source).toBe('coral-panel')
    expect(review.panel?.opinions).toHaveLength(1)
    expect(review.panel?.opinions[0].summary).toMatch(/support release/)
    expect(review.releaseEligible).toBe(false)
    expect(review.missing).toContain('Coral referee verdict')
  })

  it('blocks Coral panel release when submitted project tests fail', async () => {
    const job = submittedTask()
    await collectPanelReviewArtifacts(job, {}, collectArtifacts(artifactRun({
      tests: { status: 'fail', summary: 'Tests failed', command: 'npm test -- --run', log: 'failing spec' },
    })))

    const review = assessJobWithPanel(job, panelApprove())

    expect(review.releaseEligible).toBe(false)
    expect(review.source).toBe('coral-panel')
    expect(review.missing.join(' ')).toMatch(/tests/i)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks Coral panel release when submitted project build fails', async () => {
    const job = submittedTask()
    await collectPanelReviewArtifacts(job, {}, collectArtifacts(artifactRun({
      build: { status: 'fail', summary: 'Build failed', command: 'npm run build', log: 'missing import' },
    })))

    const review = assessJobWithPanel(job, panelApprove())

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/build/i)
  })

  it('blocks Coral panel release when visual work has no screenshots', async () => {
    const job = submittedTask()
    await collectPanelReviewArtifacts(job, {}, collectArtifacts(artifactRun({ screenshots: [] })))

    const review = assessJobWithPanel(job, panelApprove())

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/screenshots/i)
  })

  it('fails closed when Coral panel verdict times out or is missing', async () => {
    const job = submittedTask()
    await collectPanelReviewArtifacts(job, { threadId: 'thread-panel' }, collectArtifacts())

    const review = assessJobWithPanel(job, { threadId: 'thread-panel', timedOut: true })

    expect(review.source).toBe('coral-panel')
    expect(review.releaseEligible).toBe(false)
    expect(review.panel?.timedOut).toBe(true)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('accepts direct delivery only from the awarded agent and runs review', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      const handler = createHandler({ escrowAdapter: fakeEscrow(), reviewer: aiApprove(), collectArtifacts: collectArtifacts() })
      const wallet = Keypair.generate().publicKey.toBase58()
      const created = await request(handler, '/api/agents', json({ name: 'demo-worker', wallet }))
      const other = await request(handler, '/api/agents', json({ name: 'other-worker', wallet: Keypair.generate().publicKey.toBase58() }))
      await request(handler, `/api/agent/jobs/${job.id}/bids`, json({ priceSol: 0.001 }, created.body.token))
      await runAgentMarketTick(fakeEscrow(), new Date(Date.now() + 60_000))

      expect((await request(handler, `/api/agent/jobs/${job.id}/delivery`, json({
        url: 'https://example.test/preview',
        notes: 'Responsive marketplace task card budget scope mobile proof preview URL repo link acceptance item delivery proof.',
      }, other.body.token))).status).toBe(403)

      const delivered = await request(handler, `/api/agent/jobs/${job.id}/delivery`, json({
        url: 'https://example.test/preview',
        repo: 'https://github.com/example/repo',
        notes: 'Responsive marketplace task card budget scope mobile proof preview URL repo link acceptance item delivery proof.',
      }, created.body.token))
      expect(delivered.status).toBe(200)
      expect(job.status).toBe('submitted')
      expect(job.review?.source).toBe('ai')
      expect(job.review?.releaseEligible).toBe(true)
    } finally {
      restoreBuyer()
    }
  })

  it('refunds expired devnet escrow when no agent delivery arrives', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      recordAgentBid(job, { by: 'quiet-agent', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.001 })
      await awardAgentBid(job, {}, fakeEscrow())
      job.settlement.devnet!.deadlineAt = new Date(Date.now() - 1000).toISOString()

      expect(await settleAgentEscrow(job, fakeEscrow(), new Date())).toBe('refunded')
      expect(job.status).toBe('refunded')
      expect(job.settlement.refund).toBe('sig-refund')
    } finally {
      restoreBuyer()
    }
  })

  it('does not auto-refund a devnet job on fallback AI review', async () => {
    const restoreBuyer = withBuyerKey()
    try {
      const job = openTask()
      recordAgentBid(job, { by: 'fallback-agent', wallet: Keypair.generate().publicKey.toBase58(), priceSol: 0.001 })
      await awardAgentBid(job, {}, fakeEscrow())
      submitAgentDelivery(job, {
        by: 'fallback-agent',
        url: 'https://example.test/preview',
        repo: 'https://example.test/repo',
        notes: 'Delivery evidence is present.',
      })
      await assessJobWithAi(job, async () => 'not json', collectArtifacts())
      job.settlement.devnet!.deadlineAt = new Date(Date.now() - 1000).toISOString()

      expect(await settleAgentEscrow(job, fakeEscrow(), new Date())).toBeNull()
      expect(job.status).toBe('submitted')
      expect(job.settlement.refund).toBeUndefined()
    } finally {
      restoreBuyer()
    }
  })

  it('blocks release when AI approves but a criterion is unclear', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove({
      criteriaResults: [
        { label: 'Preview URL', status: 'pass', reason: 'Preview loaded.', evidence: 'preview screenshot' },
        { label: 'Mobile proof', status: 'unclear', reason: 'Mobile screenshot does not show the checkout section.', evidence: 'mobile screenshot' },
      ],
    }), collectArtifacts())

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/Mobile proof is unclear/)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release when the submitted project build fails', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({
      build: { status: 'fail', summary: 'Build failed', command: 'npm run build', log: 'missing script' },
    })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/build/i)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release when visual work has no screenshots', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({ screenshots: [] })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/screenshots/i)
  })

  it('blocks release when the preview cannot be inspected', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({
      preview: { status: 'fail', summary: 'Preview URL failed to load', url: 'https://example.test/preview', error: 'timeout' },
    })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/Preview URL/)
  })

  it('keeps AI revision recommendations from releasing funds', async () => {
    const job = submittedTask('I did the work, please release.')

    const review = await assessJobWithAi(job, aiReply({
      score: 35,
      recommendation: 'revision',
      summary: 'Submission does not show the acceptance items.',
      checks: [{ label: 'Delivery evidence', status: 'fail', reason: 'Notes are only a claim.', evidence: 'submission notes' }],
      missing: ['preview evidence', 'mobile proof'],
      risks: [],
    }), collectArtifacts())

    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)

    requestRevisionJob(job, {})

    expect(job.status).toBe('revision_requested')
  })

  it('fails closed when AI review is unavailable or unreadable', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, async () => 'not json', collectArtifacts())

    expect(review.source).toBe('fallback')
    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('does not release keyword-stuffed submissions through AI review', async () => {
    const job = submittedTask('Responsive marketplace task card budget scope mobile proof preview URL repo link acceptance item delivery proof. Responsive marketplace task card budget scope mobile proof.')

    const review = await assessJobWithAi(job, aiReply({
      score: 28,
      recommendation: 'revision',
      summary: 'The notes repeat terms but do not demonstrate completed work.',
      checks: [{ label: 'Actual evidence', status: 'fail', reason: 'Keyword stuffing without concrete proof.', evidence: 'submission notes' }],
      missing: ['specific implementation proof'],
      risks: ['keyword stuffing'],
    }), collectArtifacts())

    expect(review.risks).toContain('keyword stuffing')
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release while a dispute is active', async () => {
    const job = submittedTask()
    await assessJobWithAi(job, aiApprove(), collectArtifacts())
    disputeJob(job, { by: 'worker', note: 'Evidence is contested' })

    expect(() => approveReviewedJob(job)).toThrow(/cannot approve while job is disputed/)
  })

  it('auto-releases approved work after the employer dispute window expires', async () => {
    const job = submittedTask()
    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts())
    review.autoReleaseAt = new Date(Date.now() - 1000).toISOString()

    expect(autoReleaseExpiredJobs(new Date())).toBe(1)
    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
  })

  it('requires a concrete reason before pausing a release-eligible job', async () => {
    const job = submittedTask()
    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts())
    review.autoReleaseAt = new Date(Date.now() - 1000).toISOString()

    expect(() => disputeJob(job, { by: 'employer', note: 'no' })).toThrow(/dispute reason/)

    disputeJob(job, { by: 'employer', note: 'The mobile acceptance item is missing from the captured evidence.' })

    expect(autoReleaseExpiredJobs(new Date())).toBe(0)
    expect(job.status).toBe('disputed')
  })

  it('lets AI-backed dispute review release escrow when the dispute is unsupported', async () => {
    const job = submittedTask()
    await assessJobWithAi(job, aiApprove(), collectArtifacts())
    disputeJob(job, { by: 'employer', note: 'The delivery allegedly misses the mobile acceptance item.' })

    const review = await assessDisputeWithAi(job, aiApprove({ summary: 'Dispute is unsupported by the inspected artifacts.' }), collectArtifacts())

    expect(review.releaseEligible).toBe(true)
    expect(job.status).toBe('released')
    expect(job.disputes[0].status).toBe('resolved')
    expect(job.disputes[0].outcome).toBe('release')
  })

  it('turns supported or unclear disputes into revision instead of release', async () => {
    const job = submittedTask()
    await assessJobWithAi(job, aiApprove(), collectArtifacts())
    disputeJob(job, { by: 'employer', note: 'The submitted preview does not demonstrate the mobile acceptance item.' })

    const review = await assessDisputeWithAi(job, aiReply({
      score: 55,
      recommendation: 'revision',
      confidence: 75,
      summary: 'The mobile acceptance item is still unclear.',
      criteriaResults: [
        { label: 'Mobile proof', status: 'unclear', reason: 'Screenshot evidence does not show the required flow.', evidence: 'preview screenshot' },
      ],
      missing: ['mobile acceptance proof'],
      risks: [],
      criticalRisks: [],
      revisionInstructions: 'Resubmit with a mobile screenshot showing the accepted flow.',
    }), collectArtifacts())

    expect(review.releaseEligible).toBe(false)
    expect(job.status).toBe('revision_requested')
    expect(job.disputes[0].status).toBe('resolved')
    expect(job.disputes[0].outcome).toBe('revision')
    expect(job.settlement.release).toBeUndefined()
  })

  it('blocks invalid transitions after release', () => {
    const job = platformJob()
    submitJob(job, {
      repo: 'https://example.test/repo',
      notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
    })
    reviewJob(job)

    expect(() => refundJob(job)).toThrow(/cannot refund a released job/)
    expect(() => cancelJob(job)).toThrow(/cannot cancel a released job/)
    expect(() => submitJob(job, { notes: 'late evidence' })).toThrow(/cannot submit evidence/)
  })

  it('disputes and refunds without allowing cancelled-job mutations', () => {
    const disputed = platformJob()
    disputeJob(disputed, { by: 'worker', note: 'Scope changed after funding' })
    expect(disputed.status).toBe('disputed')
    expect(disputed.disputes[0].by).toBe('worker')
    refundJob(disputed)
    expect(disputed.status).toBe('refunded')

    const cancelled = platformJob()
    cancelJob(cancelled)
    expect(cancelled.status).toBe('cancelled')
    expect(() => completeMilestone(cancelled, cancelled.milestones[0].id)).toThrow(/cannot complete milestones/)
  })
})
