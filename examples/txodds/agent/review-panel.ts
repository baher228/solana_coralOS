import { complete, parseJsonReply } from '../../../packages/agent-runtime/src/llm/complete.ts'
import { startCoralAgent } from '../../../packages/agent-runtime/src/coral/server.ts'
import {
  formatReviewOpinion,
  formatReviewVerdict,
  parseReviewOpinion,
  parseReviewRequest,
  type ReviewOpinion,
  type ReviewRequest,
} from '../../../packages/agent-runtime/src/market/protocol.ts'

type PanelRole = 'worker' | 'employer' | 'referee'

const refereeName = process.env.REVIEW_REFEREE_AGENT || 'referee'
const waitMs = Number(process.env.REVIEW_PANEL_WAIT_MS ?? 120_000)

function panelRole(): PanelRole {
  const value = (process.env.REVIEW_PANEL_ROLE || '').toLowerCase()
  if (value === 'worker' || value === 'employer' || value === 'referee') return value
  if ((process.env.AGENT_NAME || '').includes('worker')) return 'worker'
  if ((process.env.AGENT_NAME || '').includes('employer')) return 'employer'
  return 'referee'
}

function roleName(value: PanelRole) {
  return value === 'worker' ? 'worker-advocate' : value === 'employer' ? 'employer-advocate' : 'referee'
}

function panelRoles(): PanelRole[] {
  return (process.env.REVIEW_PANEL_ROLE || '').toLowerCase() === 'all'
    ? ['worker', 'employer', 'referee']
    : [panelRole()]
}

function panelAgentName(value: PanelRole) {
  return panelRoles().length === 1 ? process.env.AGENT_NAME || roleName(value) : roleName(value)
}

function jsonObject(text: string): Record<string, unknown> {
  return parseJsonReply<Record<string, unknown>>(text) ?? { summary: text.trim() }
}

function artifactProblems(request: ReviewRequest): string[] {
  const payload = request.payload
  const run = payload.artifactRun && typeof payload.artifactRun === 'object'
    ? payload.artifactRun as Record<string, any>
    : {}
  const policy = payload.releasePolicy && typeof payload.releasePolicy === 'object'
    ? payload.releasePolicy as Record<string, unknown>
    : {}
  const problems: string[] = []
  if (run.repo?.status === 'fail') problems.push('Repository could not be inspected')
  if (run.build?.status === 'fail') problems.push('Build failed')
  if (run.tests?.status === 'fail') problems.push('Tests failed')
  if (run.preview?.status === 'fail') problems.push('Preview URL could not be inspected')
  if (policy.requireScreenshotsForVisualWork && (!Array.isArray(run.screenshots) || run.screenshots.length < 2)) {
    problems.push('Desktop and mobile screenshots are missing')
  }
  return problems
}

function fallbackOpinion(request: ReviewRequest, panelRole: Exclude<PanelRole, 'referee'>, agentName: string): Record<string, unknown> {
  const problems = artifactProblems(request)
  const worker = panelRole === 'worker'
  return {
    agent: agentName,
    role: panelRole,
    recommendation: problems.length ? 'revision' : 'approve',
    summary: problems.length
      ? `${worker ? 'Worker' : 'Employer'} advocate sees unresolved evidence issues: ${problems.join('; ')}.`
      : `${worker ? 'Worker' : 'Employer'} advocate finds the artifact evidence sufficient for release.`,
    concerns: problems,
    evidence: problems.length ? [] : ['Build/test/preview artifacts and screenshots were available.'],
  }
}

function fallbackVerdict(request: ReviewRequest, opinions: ReviewOpinion[]): Record<string, unknown> {
  const problems = [
    ...artifactProblems(request),
    ...(opinions.length < 2 ? ['Both advocate opinions were not received'] : []),
  ]
  return {
    score: problems.length ? 45 : 88,
    recommendation: problems.length ? 'revision' : 'approve',
    confidence: opinions.length < 2 ? 55 : 78,
    summary: problems.length ? `Panel cannot release yet: ${problems.join('; ')}.` : 'Panel finds the delivery release eligible.',
    criteriaResults: [{
      label: 'Artifact-backed delivery',
      status: problems.length ? 'fail' : 'pass',
      reason: problems.length ? problems.join('; ') : 'Build, tests when available, preview, and screenshots support the delivery.',
      evidence: 'Coral panel artifact review',
    }],
    missing: problems,
    criticalRisks: [],
    risks: [],
    releaseEligible: problems.length === 0,
    revisionInstructions: problems.length ? `Please address: ${problems.join('; ')}` : '',
  }
}

async function llmOpinion(request: ReviewRequest, panelRole: Exclude<PanelRole, 'referee'>, agentName: string): Promise<Record<string, unknown>> {
  try {
    return jsonObject(await complete({
      system: [
        `You are the ${panelRole} advocate in a CoralOS escrow review panel.`,
        panelRole === 'worker'
          ? 'Argue fairly for release only when artifact evidence proves the worker met the acceptance criteria.'
          : 'Argue fairly for the employer only when artifact evidence shows missing or unclear acceptance criteria.',
        'Use the provided build, test, preview, screenshot, scope, and acceptance evidence. Return only JSON.',
      ].join('\n'),
      user: JSON.stringify({
        request: request.payload,
        outputShape: { agent: agentName, role: panelRole, recommendation: 'approve|revision|dispute', summary: '...', concerns: ['...'], evidence: ['...'] },
      }),
      maxTokens: 900,
    }))
  } catch {
    return fallbackOpinion(request, panelRole, agentName)
  }
}

async function llmVerdict(request: ReviewRequest, opinions: ReviewOpinion[]): Promise<Record<string, unknown>> {
  try {
    return jsonObject(await complete({
      system: [
        'You are the referee in a CoralOS escrow review panel.',
        'Make the final escrow recommendation from objective artifacts, acceptance criteria, and both advocate opinions.',
        'Approve only when every material acceptance item is demonstrated by inspected artifacts. Return only JSON.',
      ].join('\n'),
      user: JSON.stringify({
        request: request.payload,
        opinions: opinions.map((opinion) => ({ role: opinion.role, ...opinion.payload })),
        outputShape: {
          score: 0,
          recommendation: 'approve|revision|dispute',
          confidence: 0,
          summary: '...',
          criteriaResults: [{ label: '...', status: 'pass|fail|unclear', reason: '...', evidence: '...' }],
          missing: ['...'],
          criticalRisks: ['...'],
          risks: ['...'],
          releaseEligible: false,
          revisionInstructions: '...',
        },
      }),
      maxTokens: 1400,
    }))
  } catch {
    return fallbackVerdict(request, opinions)
  }
}

async function runPanelAgent(role: PanelRole) {
  const agentName = panelAgentName(role)
  await startCoralAgent({ agentName }, async (ctx) => {
  while (true) {
    const mention = await ctx.waitForMention()
    const request = mention ? parseReviewRequest(mention.text) : null
    if (!mention || !request?.round || !mention.threadId) continue

    if (role === 'worker' || role === 'employer') {
      const payload = await llmOpinion(request, role, agentName)
      await ctx.send(formatReviewOpinion({ round: request.round, role, payload }), mention.threadId, [refereeName, mention.sender || 'marketplace-bridge'])
      continue
    }

    const opinions: ReviewOpinion[] = []
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline && opinions.length < 2) {
      const next = await ctx.waitForMentionInThread(mention.threadId, Math.min(30_000, deadline - Date.now()))
      const opinion = next ? parseReviewOpinion(next.text) : null
      if (opinion?.round === request.round) opinions.push(opinion)
    }
    await ctx.send(formatReviewVerdict({ round: request.round, payload: await llmVerdict(request, opinions) }), mention.threadId, [mention.sender || 'marketplace-bridge'])
  }
})
}

await Promise.all(panelRoles().map((role) => runPanelAgent(role)))
