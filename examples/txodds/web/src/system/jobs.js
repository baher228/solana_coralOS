import { API, DEFAULT_JOB_BRIEF } from './config.js'
import { short } from './client.js'

export function normalizeJobBrief(draft) {
  const budget = Number(draft.budgetSol)
  return {
    employer: draft.employer.trim() || DEFAULT_JOB_BRIEF.employer,
    title: draft.title.trim() || DEFAULT_JOB_BRIEF.title,
    budgetSol: Number.isFinite(budget) && budget > 0 ? String(budget) : DEFAULT_JOB_BRIEF.budgetSol,
    scope: draft.scope.trim() || DEFAULT_JOB_BRIEF.scope,
    acceptanceCriteria: draft.acceptanceCriteria.trim() || DEFAULT_JOB_BRIEF.acceptanceCriteria,
  }
}

export function jobPostBody(brief) {
  return {
    title: brief.title,
    employer: brief.employer,
    marketplace: true,
    scope: brief.scope,
    acceptanceCriteria: brief.acceptanceCriteria,
    amountSol: Number(brief.budgetSol) || Number(DEFAULT_JOB_BRIEF.budgetSol),
    milestones: [
      'Scope accepted',
      'Implementation delivered',
      'Evidence reviewed',
    ],
  }
}

export function jobBudget(brief) {
  const budget = Number(brief.budgetSol)
  return Number.isFinite(budget) ? `${budget.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL` : `${brief.budgetSol} SOL`
}

export function agentPrompt(session, job, brief) {
  const url = session.mcpUrl || `${API}/mcp`
  const auth = session.authorizationHeader || 'Authorization: Bearer <click Create MCP setup first>'
  const authValue = auth.replace(/^Authorization:\s*/i, '')
  const id = session.jobId || job?.id || '<use the matching job id from txodds_list_jobs>'
  const title = job?.title || brief.title
  const budget = job?.marketplace?.budgetSol || job?.amountSol || brief.budgetSol
  const bidValue = Number.isFinite(Number(budget)) ? Number(budget) : Number(brief.budgetSol) || 0.001
  return [
    'You are an AI worker agent on the TxOdds escrow platform. This works from Codex, OpenClaw, or any MCP-capable agent.',
    '',
    'Connect to this MCP server:',
    `MCP_URL=${url}`,
    `MCP_AUTH_HEADER=${auth}`,
    '',
    'If you are scripting this from a terminal, run from examples/txodds where the MCP SDK dependency is installed. If you are using Codex node_repl from the repo root, first add examples/txodds/node_modules to the Node module search path. Do not hand-roll JSON-RPC or parse the event stream manually.',
    'PowerShell: cd examples/txodds',
    "import { Client } from '@modelcontextprotocol/sdk/client/index.js';",
    "import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';",
    `const client = new Client({ name: 'txodds-worker', version: '1.0.0' }, { capabilities: {} });`,
    `await client.connect(new StreamableHTTPClientTransport(new URL(${JSON.stringify(url)}), { requestInit: { headers: { Authorization: ${JSON.stringify(authValue)} } } }));`,
    "await client.callTool({ name: 'txodds_agent_status', arguments: {} });",
    '',
    `Target job: ${title}`,
    `Job id: ${id}`,
    `Max bid: ${budget} SOL`,
    '',
    'Do this:',
    '1. Call txodds_agent_status.',
    '2. Call txodds_list_jobs, then txodds_get_job for the target job.',
    '3. Bid with txodds_bid_job only if the scope and acceptance criteria are clear. Use the priceSol argument.',
    '4. Build the requested work after the backend awards/funds the job.',
    '5. Submit delivery with txodds_submit_delivery. Use the exact argument names url, repo, notes, and reviewMode: "coral-panel". The url is optional when the repo is buildable; repo + notes can be enough review evidence.',
    '6. Do not settle escrow or pretend delivery is complete without evidence.',
    '',
    'Preview guidance:',
    '- Do not submit http://127.0.0.1:PORT or localhost unless the platform host itself is serving that port.',
    '- If the preview only runs on your machine, forward/tunnel that local port to a public URL first, then submit the public URL.',
    '- If you cannot expose a preview, submit a public GitHub repo with a working build script and detailed notes so the platform can build it and capture local-build screenshots.',
    '',
    'Exact tool-call shape:',
    `await client.callTool({ name: 'txodds_get_job', arguments: { jobId: ${JSON.stringify(id)} } });`,
    `await client.callTool({ name: 'txodds_bid_job', arguments: { jobId: ${JSON.stringify(id)}, priceSol: ${bidValue}, note: 'I can deliver the requested scope and acceptance criteria.' } });`,
    `await client.callTool({ name: 'txodds_submit_delivery', arguments: { jobId: ${JSON.stringify(id)}, repo: 'https://github.com/OWNER/REPO', notes: 'Acceptance criteria evidence and delivery notes. Include a public forwarded preview URL here only if available.', reviewMode: 'coral-panel' } });`,
  ].join('\n')
}

export function jobAwareStep(step, brief) {
  const metrics = { ...step.metrics, budget: jobBudget(brief) }
  if (step.id === 'post') {
    return {
      ...step,
      title: 'Employer sets up job',
      copy: `${brief.employer} posts "${brief.title}" with a ${jobBudget(brief)} budget. ${brief.scope}`,
      metrics,
    }
  }
  if (step.id === 'feed') {
    return {
      ...step,
      copy: `The agent network receives the job brief, acceptance criteria, budget, and escrow terms for "${brief.title}".`,
      metrics,
    }
  }
  if (step.id === 'delivery') {
    return {
      ...step,
      copy: `The worker agent submits evidence against the job brief: ${brief.acceptanceCriteria}`,
      metrics,
    }
  }
  if (step.id === 'artifacts') {
    return {
      ...step,
      copy: 'The platform verifies the delivery against the acceptance criteria before the Coral panel can judge it.',
      metrics,
    }
  }
  return { ...step, metrics }
}

export function newest(jobs) {
  return [...jobs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
}

export function latestAgentJob(jobs) {
  return newest(jobs.filter((job) => job.marketplace || job.settlement?.mode === 'devnet-escrow')) || newest(jobs)
}

export function latestCoralPanelJob(jobs) {
  return newest((jobs || []).filter((job) => job.review?.source === 'coral-panel'))
}

export function jobById(data, id) {
  return id ? (data.jobs || []).find((job) => job.id === id) : null
}

export function reviewLabel(review) {
  if (!review) return '--'
  if (review.source === 'coral-panel') {
    const recommendation = review.recommendation || (review.releaseEligible ? 'approve' : 'pending')
    return `Coral ${recommendation}`
  }
  if (review.source === 'ai') return 'Artifact AI'
  if (review.source === 'fallback') return 'Review blocked'
  return review.source || 'reviewed'
}

export function artifactState(run, key) {
  return run?.[key]?.status || '--'
}

export function panelStep(review) {
  const panel = review?.panel
  if (panel?.verdict) return 'Verdict ready'
  if (panel?.opinions?.length) return `${panel.opinions.length}/2 opinions`
  if (panel?.threadId) return 'Thread open'
  if (review?.artifactRun) return 'Artifacts ready'
  return '--'
}

export function liveSnapshot(data) {
  const jobs = data.jobs || []
  const agents = data.agents || []
  const job = latestAgentJob(jobs)
  const bid = job?.marketplace?.awardedBid || job?.marketplace?.bids?.[0]
  return {
    job,
    agents,
    metrics: {
      budget: job ? `${job.marketplace?.budgetSol || job.amountSol} SOL` : '--',
      bid: bid ? `${bid.priceSol} SOL` : '--',
      escrow: job?.settlement?.devnet?.deposit ? short(job.settlement.devnet.deposit) : job?.settlement?.mode || '--',
      review: reviewLabel(job?.review),
      settlement: job?.settlement?.release ? short(job.settlement.release) : job?.settlement?.refund ? short(job.settlement.refund) : '--',
    },
  }
}

export function liveStepIndex(runner, job) {
  if (job?.settlement?.release || job?.settlement?.refund) return 10
  if (job?.review?.panel?.verdict) return 9
  if (job?.review?.panel?.opinions?.length) return 8
  if (job?.review?.panel?.threadId) return 7
  if (job?.review?.artifactRun) return 6
  if (job?.review || runner.steps?.reviewCaptured) return 9
  if (job?.submission || runner.steps?.deliverySubmitted) return 5
  if (job?.settlement?.devnet?.deposit || runner.steps?.funded) return 4
  if (job?.marketplace?.awardedBid || runner.steps?.awarded) return 3
  if (job?.marketplace?.bids?.length || runner.steps?.bidPlaced) return 2
  if (job || runner.steps?.jobPosted) return 1
  return 0
}
