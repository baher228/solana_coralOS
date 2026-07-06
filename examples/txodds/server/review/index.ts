import http from 'node:http'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { complete, parseJsonReply } from '../../../../packages/agent-runtime/src/llm/complete.ts'
import { AUTO_RELEASE_MS, MAX_LOG_CHARS, MAX_SNIPPET_CHARS, REVIEW_DIR, REVIEW_TIMEOUT_MS } from '../config.js'
import { jobs } from '../store.js'
import type { Actor, ArtifactKind, ArtifactResult, ArtifactRun, BuildArtifact, Dispute, Job, PreviewArtifact, RepoArtifact, Review, ReviewArtifact, ReviewCheck, ReviewCheckStatus, ReviewPanel, ReviewPanelOpinion, ReviewRecommendation, ReviewSource, TestArtifact } from '../types.js'
import { activeDispute, addEvent, addSettlementEvent, deadlineFrom, ensureStatus, fail, now, terminal } from '../domain/utils.js'

export type ReviewCompletion = (opts: { system: string; user: string; maxTokens?: number }) => Promise<string>
export type ArtifactCollector = (job: Job) => Promise<ArtifactRun>
export type CommandResult = { ok: boolean; code: number | null; timedOut: boolean; output: string }

export interface AiReviewReply {
  score?: unknown
  recommendation?: unknown
  summary?: unknown
  checks?: unknown
  criteriaResults?: unknown
  missing?: unknown
  risks?: unknown
  confidence?: unknown
  criticalRisks?: unknown
  releaseEligible?: unknown
  revisionInstructions?: unknown
}

const REVIEW_SYSTEM = `You are the escrow review agent for a freelance marketplace.
Review the job against the artifact evidence collected by the backend: repository scan, build result, preview metadata, screenshots, worker notes, messages, milestones, scope, and acceptance criteria.
When reviewing a dispute, judge the dispute reason against the same evidence and worker/employer messages. Do not treat refusal to pay as evidence by itself.
Reject keyword stuffing, generic promises, unsupported claims, and links that could not be inspected. Use unclear when evidence is incomplete.
Approve only when every material acceptance item is demonstrated by inspected artifacts.
A public preview URL is optional when the submitted repository can be built and the backend captures local-build screenshots. Do not rely on 127.0.0.1/localhost preview URLs unless they were produced by backend artifact collection.
Return only JSON with this shape: {"score":0-100,"recommendation":"approve|revision|dispute","confidence":0-100,"summary":"...","criteriaResults":[{"label":"...","status":"pass|fail|unclear","reason":"...","evidence":"..."}],"missing":["..."],"criticalRisks":["..."],"risks":["..."],"releaseEligible":false,"revisionInstructions":"..."}.`

function safeReviewEnv(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  return Object.fromEntries(keys.flatMap((key) => process.env[key] ? [[key, process.env[key] as string]] : []))
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function artifactFile(file: string) {
  return path.relative(REVIEW_DIR, file).replace(/\\/g, '/')
}

async function addArtifact(run: ArtifactRun, dir: string, kind: ArtifactKind, label: string, fileName: string, content: string | Buffer, mime: string): Promise<ReviewArtifact> {
  const file = path.join(dir, fileName)
  await fs.writeFile(file, content)
  const artifact = { id: `${run.id}_${fileName.replace(/[^a-z0-9.]+/gi, '_')}`, kind, label, file: artifactFile(file), mime }
  if (kind === 'screenshot') run.screenshots.push(artifact)
  else run.logs.push(artifact)
  return artifact
}

function trimLog(input: string) {
  return input.length > MAX_LOG_CHARS ? input.slice(-MAX_LOG_CHARS) : input
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = REVIEW_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const child = spawn(command, args, { cwd, env: safeReviewEnv(), windowsHide: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { output = trimLog(output + chunk.toString()) })
    child.stderr.on('data', (chunk) => { output = trimLog(output + chunk.toString()) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, timedOut, output: trimLog(`${output}\n${error.message}`) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, code, timedOut, output: trimLog(output) })
    })
  })
}

function githubCloneUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null
    const [owner, repo] = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean)
    if (!owner || !repo) return null
    return `https://github.com/${owner}/${repo}.git`
  } catch {
    return null
  }
}

function fileRepoPath(input: string): string | null {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'file:' ? fileURLToPath(url) : null
  } catch {
    return null
  }
}

function copyableRepoFile(source: string): boolean {
  return !['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'].includes(path.basename(source))
}

async function exists(file: string) {
  try { await fs.access(file); return true } catch { return false }
}

async function readJsonFile<T = Record<string, unknown>>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T } catch { return null }
}

async function detectPackageManager(repoDir: string): Promise<string> {
  if (await exists(path.join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(path.join(repoDir, 'yarn.lock'))) return 'yarn'
  if (await exists(path.join(repoDir, 'bun.lockb')) || await exists(path.join(repoDir, 'bun.lock'))) return 'bun'
  return 'npm'
}

async function walkRepoFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  if (out.length >= 24) return out
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= 24) break
    if (['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (rel.split('/').length <= 3) await walkRepoFiles(root, full, out)
    } else if (/^(readme|package\.json)|\.(tsx?|jsx?|css|html|md)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

async function scanRepo(repoDir: string): Promise<Pick<RepoArtifact, 'packageManager' | 'scripts' | 'files'>> {
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoDir, 'package.json'))
  const files = []
  for (const file of await walkRepoFiles(repoDir)) {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat || stat.size > 120_000) continue
    files.push({
      path: path.relative(repoDir, file).replace(/\\/g, '/'),
      snippet: (await fs.readFile(file, 'utf8')).slice(0, MAX_SNIPPET_CHARS),
    })
    if (files.length >= 12) break
  }
  return { packageManager: await detectPackageManager(repoDir), scripts: pkg?.scripts || {}, files }
}

async function findBuildOutput(repoDir: string): Promise<string | undefined> {
  for (const name of ['dist', 'build', 'out', 'public']) {
    const candidate = path.join(repoDir, name)
    if (await exists(candidate)) return candidate
  }
  return undefined
}

async function installRepoDeps(repoDir: string, run: ArtifactRun, dir: string): Promise<CommandResult & { command: string }> {
  const npm = npmCommand()
  const hasLock = await exists(path.join(repoDir, 'package-lock.json'))
  const installArgs = hasLock ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund'] : ['install', '--ignore-scripts', '--no-audit', '--no-fund']
  const command = `${npm} ${installArgs.join(' ')}`
  if (await exists(path.join(repoDir, 'node_modules'))) return { ok: true, code: 0, timedOut: false, output: 'node_modules already present', command }
  const install = await runCommand(npm, installArgs, repoDir)
  await addArtifact(run, dir, 'log', 'Install log', 'install.log', install.output || '(no output)', 'text/plain')
  return { ...install, command }
}

async function buildRepo(repoDir: string, run: ArtifactRun, dir: string): Promise<BuildArtifact> {
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoDir, 'package.json'))
  if (!pkg?.scripts?.build) return { status: 'skipped', summary: 'No package build script found' }
  const npm = npmCommand()
  const install = await installRepoDeps(repoDir, run, dir)
  if (!install.ok) return { status: 'fail', summary: install.timedOut ? 'Install timed out' : 'Install failed', command: install.command, log: install.output }
  const build = await runCommand(npm, ['run', 'build'], repoDir)
  await addArtifact(run, dir, 'log', 'Build log', 'build.log', build.output || '(no output)', 'text/plain')
  const outputDir = build.ok ? await findBuildOutput(repoDir) : undefined
  return {
    status: build.ok ? 'pass' : 'fail',
    summary: build.ok ? 'Build completed' : build.timedOut ? 'Build timed out' : 'Build failed',
    command: `${npm} run build`,
    ...(outputDir ? { outputDir } : {}),
    log: build.output,
  }
}

async function testRepo(repoDir: string, run: ArtifactRun, dir: string): Promise<TestArtifact> {
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoDir, 'package.json'))
  if (!pkg?.scripts?.test) return { status: 'skipped', summary: 'No package test script found' }
  const npm = npmCommand()
  const install = await installRepoDeps(repoDir, run, dir)
  if (!install.ok) return { status: 'fail', summary: install.timedOut ? 'Install timed out' : 'Install failed', command: install.command, log: install.output }
  const test = await runCommand(npm, ['test', '--', '--run'], repoDir)
  await addArtifact(run, dir, 'log', 'Test log', 'test.log', test.output || '(no output)', 'text/plain')
  return {
    status: test.ok ? 'pass' : 'fail',
    summary: test.ok ? 'Tests passed' : test.timedOut ? 'Tests timed out' : 'Tests failed',
    command: `${npm} test -- --run`,
    log: test.output,
  }
}

async function inspectPreview(url: string): Promise<PreviewArtifact> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const contentType = res.headers.get('content-type') || ''
    const text = contentType.includes('text/html') ? (await res.text()).slice(0, 120_000) : ''
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    return { status: res.ok ? 'pass' : 'fail', summary: res.ok ? 'Preview URL loaded' : `Preview returned HTTP ${res.status}`, url, httpStatus: res.status, ...(title ? { title } : {}) }
  } catch (e) {
    return { status: 'fail', summary: 'Preview URL failed to load', url, error: (e as Error).message }
  }
}

function localPreviewUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function submittedEvidenceUrls(job: Job): string[] {
  const submission = job.submission
  if (!submission) return []
  return [
    ...(submission.evidenceUrls || []),
    ...(submission.photoUrls || []),
    ...(submission.videoUrls || []),
  ].map((url) => String(url || '').trim()).filter(Boolean)
}

function workerVisualEvidenceCount(job: Job): number {
  const submission = job.submission
  if (!submission) return 0
  const media = [
    ...(submission.photoUrls || []),
    ...(submission.videoUrls || []),
    ...(submission.evidenceUrls || []).filter((url) => /\.(png|jpe?g|webp|gif|mp4|mov|webm)(?:[?#].*)?$/i.test(url)),
  ]
  return media.map((url) => String(url || '').trim()).filter(Boolean).length
}

async function serveStatic(root: string, fn: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const requested = decodeURIComponent(new URL(req.url || '/', 'http://local').pathname)
      const rel = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
      const file = path.resolve(root, rel)
      if (!file.startsWith(path.resolve(root))) {
        res.statusCode = 403; res.end('forbidden'); return
      }
      const stat = await fs.stat(file).catch(() => null)
      const chosen = stat?.isDirectory() ? path.join(file, 'index.html') : file
      res.end(await fs.readFile(chosen))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await fn(`http://127.0.0.1:${port}/`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function takeScreenshots(targetUrl: string, run: ArtifactRun, dir: string, prefix: string): Promise<ArtifactResult> {
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      for (const viewport of [
        { name: 'desktop', width: 1365, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
      ]) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 25000 })
        const fileName = `${prefix}-${viewport.name}.png`
        const file = path.join(dir, fileName)
        await page.screenshot({ path: file, fullPage: true })
        run.screenshots.push({ id: `${run.id}_${fileName}`, kind: 'screenshot', label: `${prefix} ${viewport.name}`, file: artifactFile(file), mime: 'image/png' })
        await page.close()
      }
    } finally {
      await browser.close()
    }
    return { status: 'pass', summary: `${prefix} screenshots captured` }
  } catch (e) {
    await addArtifact(run, dir, 'log', `${prefix} screenshot error`, `${prefix}-screenshot.log`, (e as Error).message, 'text/plain')
    return { status: 'fail', summary: `${prefix} screenshot failed`, error: (e as Error).message }
  }
}

export async function collectReviewArtifacts(job: Job): Promise<ArtifactRun> {
  const run: ArtifactRun = {
    id: `review_${Date.now().toString(36)}`,
    at: now(),
    repo: { status: 'skipped', summary: 'No repository submitted' },
    build: { status: 'skipped', summary: 'No build attempted' },
    tests: { status: 'skipped', summary: 'No tests attempted' },
    preview: { status: 'skipped', summary: 'No preview URL submitted' },
    screenshots: [],
    logs: [],
  }
  const dir = path.join(REVIEW_DIR, job.id, run.id)
  await fs.mkdir(dir, { recursive: true })
  const workerEvidence = submittedEvidenceUrls(job)
  if (workerEvidence.length) {
    await addArtifact(run, dir, 'link', 'Worker-submitted media evidence', 'worker-evidence.json', JSON.stringify(workerEvidence, null, 2), 'application/json')
  }
  if (job.submission?.repo) {
    const cloneUrl = githubCloneUrl(job.submission.repo)
    const localRepo = cloneUrl ? null : fileRepoPath(job.submission.repo)
    if (!cloneUrl && !localRepo) {
      run.repo = { status: 'fail', summary: 'Only public HTTPS GitHub repos are supported in v1', url: job.submission.repo }
    } else {
      const repoDir = path.join(dir, 'repo')
      if (localRepo) {
        const stat = await fs.stat(localRepo).catch(() => null)
        if (!stat?.isDirectory()) {
          run.repo = { status: 'fail', summary: 'Local repository path is not a directory', url: job.submission.repo }
        } else {
          await fs.cp(localRepo, repoDir, { recursive: true, filter: copyableRepoFile })
          run.repo = { status: 'pass', summary: 'Local repository copied and scanned', url: job.submission.repo, ...(await scanRepo(repoDir)) }
          run.build = await buildRepo(repoDir, run, dir)
          run.tests = await testRepo(repoDir, run, dir)
        }
      } else {
        const clone = await runCommand('git', ['clone', '--depth', '1', cloneUrl!, repoDir], dir)
        await addArtifact(run, dir, 'log', 'Clone log', 'clone.log', clone.output || '(no output)', 'text/plain')
        if (!clone.ok) {
          run.repo = { status: 'fail', summary: clone.timedOut ? 'Repository clone timed out' : 'Repository clone failed', url: job.submission.repo, log: clone.output }
        } else {
          const commit = await runCommand('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], dir, 10000)
          run.repo = { status: 'pass', summary: 'Repository cloned and scanned', url: job.submission.repo, commit: commit.output.trim(), ...(await scanRepo(repoDir)) }
          run.build = await buildRepo(repoDir, run, dir)
          run.tests = await testRepo(repoDir, run, dir)
        }
      }
      if (run.build.outputDir) {
        const outputDir = run.build.outputDir
        await serveStatic(outputDir, async (url) => {
          const shot = await takeScreenshots(url, run, dir, 'local-build')
          if (shot.status === 'fail') run.build = { ...run.build, status: 'fail', summary: shot.summary, error: shot.error }
        })
        run.build.outputDir = path.relative(dir, outputDir).replace(/\\/g, '/')
      }
    }
  }
  if (job.submission?.url && localPreviewUrl(job.submission.url)) {
    run.preview = { status: 'skipped', summary: 'Local preview URL ignored; submit a public forwarded URL or a buildable repository artifact', url: job.submission.url }
  } else if (job.submission?.url) {
    run.preview = await inspectPreview(job.submission.url)
    const shot = await takeScreenshots(job.submission.url, run, dir, 'preview')
    if (shot.status === 'fail') run.preview = { ...run.preview, status: 'fail', summary: shot.summary, error: shot.error }
  }
  return run
}

function textList(input: unknown, limit = 8): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
}

function reviewScore(input: unknown): number {
  const score = Number(input)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

function reviewRecommendation(input: unknown): ReviewRecommendation {
  return input === 'approve' || input === 'dispute' ? input : 'revision'
}

function reviewChecks(input: unknown): ReviewCheck[] {
  if (!Array.isArray(input)) return []
  return input.map((item, i) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const status: ReviewCheckStatus = source.status === 'pass' || source.status === 'fail' || source.status === 'unclear' ? source.status : 'unclear'
    return {
      label: String(source.label || `Check ${i + 1}`).trim(),
      status,
      reason: String(source.reason || '').trim(),
      evidence: String(source.evidence || '').trim(),
    }
  }).filter((item) => item.label).slice(0, 10)
}

function visualReviewRequired(job: Job): boolean {
  return /preview|screenshot|mobile|responsive|ui|ux|layout|page|frontend|design|visual/i.test(`${job.scope} ${job.acceptanceCriteria}`)
}

function artifactGateProblems(job: Job, run?: ArtifactRun): string[] {
  if (!run) return ['Artifact review did not run']
  const problems = []
  if (job.submission?.repo && run.repo.status !== 'pass') problems.push('Repository could not be inspected')
  if (run.build.status === 'fail') problems.push('Submitted project did not build cleanly')
  if (run.tests.status === 'fail') problems.push('Submitted project tests failed')
  if (job.submission?.url && !localPreviewUrl(job.submission.url) && run.preview.status !== 'pass') problems.push('Preview URL could not be inspected')
  if (visualReviewRequired(job) && run.screenshots.length < 2 && workerVisualEvidenceCount(job) === 0) {
    problems.push('Required visual screenshots or worker-submitted photo/video evidence were not captured')
  }
  return problems
}

function releaseGateProblems(job: Job, review: Review, options: { ignoreActiveDispute?: boolean } = {}): string[] {
  const criteria = review.criteriaResults.length ? review.criteriaResults : review.checks
  return [
    ...(review.recommendation !== 'approve' ? ['Review did not recommend release'] : []),
    ...(review.score < 80 ? ['Review score is below 80'] : []),
    ...(!criteria.length ? ['Acceptance criteria were not checked'] : criteria.filter((check) => check.status !== 'pass').map((check) => `${check.label} is ${check.status}`)),
    ...review.missing,
    ...review.criticalRisks,
    ...artifactGateProblems(job, review.artifactRun),
    ...(!options.ignoreActiveDispute && activeDispute(job) ? ['An active dispute blocks release'] : []),
  ].filter(Boolean).slice(0, 12)
}

function finalizeReviewGates(job: Job, review: Review, options: { ignoreActiveDispute?: boolean } = {}): Review {
  const problems = releaseGateProblems(job, review, options)
  const missing = [...new Set([...review.missing, ...problems])]
  const releaseEligible = problems.length === 0
  return {
    ...review,
    missing: missing.slice(0, 12),
    releaseEligible,
    approved: releaseEligible,
    autoReleaseAt: releaseEligible ? review.autoReleaseAt || deadlineFrom(review.at) : undefined,
    revisionInstructions: review.revisionInstructions || (problems.length ? `Please address: ${problems.join('; ')}` : 'Ready for employer release.'),
  }
}

function fallbackReview(summary = 'AI review is unavailable; request clearer evidence or retry assessment.', artifactRun?: ArtifactRun): Review {
  return {
    at: now(),
    approved: false,
    score: 0,
    summary,
    missing: ['Reliable AI assessment'],
    source: 'fallback',
    recommendation: 'revision',
    checks: [],
    risks: ['No funds were released automatically.'],
    criteriaResults: [],
    ...(artifactRun ? { artifactRun } : {}),
    confidence: 0,
    criticalRisks: ['Reliable AI assessment is missing'],
    releaseEligible: false,
    revisionInstructions: summary,
  }
}

function artifactSummary(run: ArtifactRun): ReviewPanel['artifactSummary'] {
  return {
    repo: run.repo.status,
    build: run.build.status,
    tests: run.tests.status,
    preview: run.preview.status,
    screenshots: run.screenshots.length,
  }
}

function reviewPanelOpinions(input: unknown): ReviewPanelOpinion[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const role = source.role === 'worker' || source.role === 'employer' ? source.role : null
    const summary = String(source.summary || '').trim()
    if (!role || !summary) return null
    return {
      role,
      ...(source.agent ? { agent: String(source.agent) } : {}),
      summary,
      ...(source.recommendation === 'approve' || source.recommendation === 'revision' || source.recommendation === 'dispute'
        ? { recommendation: source.recommendation }
        : {}),
      concerns: textList(source.concerns),
      evidence: textList(source.evidence),
    }
  }).filter((item): item is ReviewPanelOpinion => Boolean(item)).slice(0, 6)
}

function reviewPrompt(job: Job, artifactRun?: ArtifactRun, mode: 'delivery' | 'dispute' = 'delivery'): string {
  return JSON.stringify({
    mode,
    job: {
      title: job.title,
      status: job.status,
      employer: job.employer,
      worker: job.worker,
      amountSol: job.amountSol,
      scope: job.scope,
      acceptanceCriteria: job.acceptanceCriteria,
      milestones: job.milestones.map(({ title, description, status }) => ({ title, description, status })),
      messages: job.messages.slice(-20),
      submission: job.submission,
      disputes: job.disputes,
      activity: job.events.slice(0, 20).reverse(),
    },
    artifactRun,
    releasePolicy: {
      minimumScore: 80,
      requireEveryCriterionPass: true,
      requireNoCriticalRisks: true,
      requireScreenshotsForVisualWork: visualReviewRequired(job) && workerVisualEvidenceCount(job) === 0,
      workerSubmittedVisualEvidence: workerVisualEvidenceCount(job),
      finalReleaseBy: mode === 'dispute' ? 'backend after unsupported dispute' : 'employer or auto-release timeout',
      disputeRule: 'If the employer dispute is not supported by the platform-visible evidence and all release gates pass, recommend approve. If evidence is incomplete, recommend revision. Use dispute only for unresolved fraud, safety, or contract ambiguity.',
    },
  }, null, 2)
}

function normalizeAiReview(
  job: Job,
  artifactRun: ArtifactRun,
  reply: AiReviewReply | null,
  gateOptions: { ignoreActiveDispute?: boolean } = {},
  source: ReviewSource = 'ai',
  panel?: ReviewPanel,
): Review | null {
  if (!reply) return null
  const criteriaResults = reviewChecks(reply.criteriaResults || reply.checks)
  const checks = criteriaResults.length ? criteriaResults : reviewChecks(reply.checks)
  const missing = textList(reply.missing)
  let recommendation = reviewRecommendation(reply.recommendation)
  if (recommendation === 'approve' && (!checks.length || checks.some((check) => check.status !== 'pass') || missing.length)) {
    recommendation = 'revision'
  }
  const review: Review = {
    at: now(),
    approved: false,
    score: reviewScore(reply.score),
    summary: String(reply.summary || '').trim() || (source === 'coral-panel' ? 'Coral panel review completed.' : 'AI review completed.'),
    missing: recommendation === 'revision' && !missing.length ? ['Clearer delivery evidence'] : missing,
    source,
    recommendation,
    checks,
    risks: textList(reply.risks),
    criteriaResults,
    artifactRun,
    confidence: reviewScore(reply.confidence),
    criticalRisks: textList(reply.criticalRisks),
    releaseEligible: false,
    revisionInstructions: String(reply.revisionInstructions || '').trim(),
    ...(panel ? { panel } : {}),
  }
  return finalizeReviewGates(job, review, gateOptions)
}

export function reviewJob(job: Job): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const haystack = `${job.submission.url} ${job.submission.repo} ${job.submission.notes}`.toLowerCase()
  const terms = `${job.scope} ${job.acceptanceCriteria}`.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4)
  const hits = new Set(terms.filter((w) => haystack.includes(w)))
  const hasEvidence = Boolean(job.submission.url || job.submission.repo || job.submission.notes.length > 30)
  const score = Math.min(100, Math.round((hits.size / Math.max(1, terms.length)) * 70 + (hasEvidence ? 30 : 0)))
  const missing = [...new Set(terms.filter((w) => !hits.has(w)))].slice(0, 5)
  const review = {
    at: now(),
    approved: score >= 45 && hasEvidence,
    score,
    summary: score >= 45 && hasEvidence
      ? 'Delivery includes enough evidence to release the local demo escrow.'
      : 'Delivery needs clearer evidence before release.',
    missing,
    source: 'legacy-heuristic' as const,
    recommendation: (score >= 45 && hasEvidence ? 'approve' : 'revision') as ReviewRecommendation,
    checks: [],
    risks: [],
    criteriaResults: [],
    confidence: score,
    criticalRisks: [],
    releaseEligible: score >= 45 && hasEvidence,
    revisionInstructions: score >= 45 && hasEvidence ? '' : 'Provide clearer delivery evidence before release.',
  }
  job.review = review
  job.status = review.approved ? 'released' : 'revision_requested'
  if (review.approved) {
    job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
    job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || review.at }))
    addSettlementEvent(job, 'released', `Released ${job.amountSol} SOL to ${job.worker}`)
  } else {
    addSettlementEvent(job, 'reviewed', 'Review requested clearer delivery evidence')
  }
  addEvent(job, 'agent', review.approved ? 'released' : 'revision_requested', review.summary)
  return review
}

async function runAiReview(
  job: Job,
  mode: 'delivery' | 'dispute',
  reviewer: ReviewCompletion,
  collectArtifacts: ArtifactCollector,
  gateOptions: { ignoreActiveDispute?: boolean } = {},
): Promise<Review> {
  let review: Review
  let artifactRun: ArtifactRun | undefined
  try {
    artifactRun = await collectArtifacts(job)
    review = normalizeAiReview(job, artifactRun, parseJsonReply<AiReviewReply>(await reviewer({
      system: REVIEW_SYSTEM,
      user: reviewPrompt(job, artifactRun, mode),
      maxTokens: 2000,
    })), gateOptions) ?? finalizeReviewGates(job, fallbackReview('AI review returned an unreadable assessment; request clearer evidence or retry.', artifactRun), gateOptions)
  } catch {
    review = finalizeReviewGates(job, fallbackReview('Artifact or AI review failed; request clearer evidence or retry assessment.', artifactRun), gateOptions)
  }
  return review
}

export async function assessJobWithAi(job: Job, reviewer: ReviewCompletion = complete, collectArtifacts: ArtifactCollector = collectReviewArtifacts): Promise<Review> {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const review = await runAiReview(job, 'delivery', reviewer, collectArtifacts)
  job.review = review
  addEvent(job, 'agent', 'ai_reviewed', review.summary)
  addSettlementEvent(job, 'reviewed', review.releaseEligible ? 'Artifact review passed; employer release is enabled' : 'Artifact review requested clearer delivery evidence')
  return review
}

export async function collectPanelReviewArtifacts(
  job: Job,
  input: Record<string, unknown> = {},
  collectArtifacts: ArtifactCollector = collectReviewArtifacts,
): Promise<Review> {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const artifactRun = await collectArtifacts(job)
  const panel: ReviewPanel = {
    ...(input.threadId ? { threadId: String(input.threadId) } : {}),
    opinions: [],
    artifactSummary: artifactSummary(artifactRun),
  }
  const review = finalizeReviewGates(job, {
    at: now(),
    approved: false,
    score: 0,
    summary: 'Coral panel review is waiting for advocate opinions and referee verdict.',
    missing: ['Coral referee verdict'],
    source: 'coral-panel',
    recommendation: 'revision',
    checks: [],
    risks: [],
    criteriaResults: [],
    artifactRun,
    confidence: 0,
    criticalRisks: [],
    releaseEligible: false,
    revisionInstructions: 'Wait for the Coral referee verdict before settlement.',
    panel,
  })
  job.review = review
  addEvent(job, 'agent', 'coral_panel_artifacts', 'Collected build, test, preview, and screenshot evidence for Coral panel review')
  addSettlementEvent(job, 'reviewed', 'Coral panel review collected artifacts and is waiting for verdict')
  return review
}

export function panelReviewRequest(job: Job): Record<string, unknown> {
  const artifactRun = job.review?.artifactRun
  return JSON.parse(reviewPrompt(job, artifactRun, 'delivery')) as Record<string, unknown>
}

function objectRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
}

export function assessJobWithPanel(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const artifactRun = job.review?.artifactRun
  if (!artifactRun) fail('review artifacts are required before Coral panel verdict', 409)
  const verdict = objectRecord(input.verdict) ?? (input.recommendation ? input : null)
  const panel: ReviewPanel = {
    ...(input.threadId ? { threadId: String(input.threadId) } : job.review?.panel?.threadId ? { threadId: job.review.panel.threadId } : {}),
    opinions: reviewPanelOpinions(input.opinions),
    ...(verdict ? { verdict } : {}),
    ...(input.timedOut ? { timedOut: true } : {}),
    artifactSummary: artifactSummary(artifactRun),
  }
  const failed = input.timedOut || !verdict
  const review = failed
    ? finalizeReviewGates(job, {
      ...fallbackReview(input.timedOut ? 'Coral panel referee timed out; request clearer evidence or retry panel review.' : 'Coral panel referee returned an unreadable verdict; request clearer evidence or retry panel review.', artifactRun),
      source: 'coral-panel',
      panel,
    })
    : normalizeAiReview(job, artifactRun, verdict as AiReviewReply, {}, 'coral-panel', panel)
      ?? finalizeReviewGates(job, { ...fallbackReview('Coral panel referee returned an unreadable verdict; request clearer evidence or retry panel review.', artifactRun), source: 'coral-panel', panel })
  job.review = review
  addEvent(job, 'agent', 'coral_panel_reviewed', review.summary)
  addSettlementEvent(job, 'reviewed', review.releaseEligible ? 'Coral panel review passed; agent settlement can release after the dispute window' : 'Coral panel review requested clearer delivery evidence')
  return review
}

export function recordPanelOpinions(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  const artifactRun = job.review?.artifactRun
  if (!artifactRun || job.review?.source !== 'coral-panel') fail('Coral panel artifacts are required before advocate opinions', 409)
  const incoming = reviewPanelOpinions(input.opinions)
  const byRole = new Map<string, ReviewPanelOpinion>()
  for (const opinion of job.review.panel?.opinions || []) byRole.set(opinion.role, opinion)
  for (const opinion of incoming) byRole.set(opinion.role, opinion)
  const opinions = [...byRole.values()]
  job.review = {
    ...job.review,
    summary: opinions.length
      ? `Coral panel has ${opinions.length}/2 advocate opinion${opinions.length === 1 ? '' : 's'}; waiting for referee verdict.`
      : job.review.summary,
    missing: ['Coral referee verdict'],
    releaseEligible: false,
    panel: {
      ...(job.review.panel || { opinions: [], artifactSummary: artifactSummary(artifactRun) }),
      ...(input.threadId ? { threadId: String(input.threadId) } : {}),
      opinions,
      artifactSummary: artifactSummary(artifactRun),
    },
  }
  if (incoming.length) addEvent(job, 'agent', 'coral_panel_opinion', incoming.map((opinion) => `${opinion.role}: ${opinion.summary}`).join(' | '))
  return job.review
}

function releaseReviewedJob(job: Job, actor: Actor, summary: string): Review {
  if (!job.review) fail('AI review is required before release', 409)
  const releasedAt = now()
  job.review = { ...job.review, approved: true, recommendation: 'approve' }
  job.status = 'released'
  job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
  job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || releasedAt }))
  addSettlementEvent(job, 'released', `Released ${job.amountSol} SOL to ${job.worker}`)
  addEvent(job, actor, 'released', summary)
  return job.review
}

export function approveReviewedJob(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'approve')
  if (!job.submission) fail('worker submission is required')
  if (!job.review) fail('AI review is required before release', 409)
  if (!job.review.releaseEligible) fail('review gates do not allow release', 409)
  if (job.settlement.mode === 'devnet-escrow') fail('devnet escrow release uses agent settlement', 409)
  return releaseReviewedJob(job, 'employer', 'Employer approved delivery after AI review')
}

export function requestRevisionJob(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'request revision for')
  if (!job.submission) fail('worker submission is required')
  const note = String(input.note || job.review?.missing?.join('; ') || 'Please address the review notes and resubmit evidence.').trim()
  const review = job.review || fallbackReview(note)
  job.review = { ...review, approved: false, recommendation: 'revision' }
  job.status = 'revision_requested'
  addSettlementEvent(job, 'reviewed', note)
  addEvent(job, 'employer', 'revision_requested', note)
  return job.review
}

function resolveActiveDispute(job: Job, outcome: NonNullable<Dispute['outcome']>, summary: string): void {
  const dispute = activeDispute(job)
  if (!dispute) return
  dispute.status = 'resolved'
  dispute.outcome = outcome
  dispute.reviewedAt = now()
  dispute.summary = summary
}

export function disputeJob(job: Job, input: Record<string, unknown>): Dispute {
  ensureStatus(job, ['funded', 'submitted', 'approved', 'revision_requested', 'disputed'], 'dispute')
  const by: Dispute['by'] = input.by === 'worker' ? 'worker' : 'employer'
  if (activeDispute(job)) fail('dispute already open', 409)
  const note = String(input.note || '').trim()
  if (job.review?.releaseEligible && note.length < 20) fail('dispute reason must explain the acceptance issue', 400)
  const dispute = {
    at: now(),
    by,
    note: note || 'Dispute opened for manual review',
    status: 'open' as const,
  }
  job.disputes.unshift(dispute)
  job.status = 'disputed'
  addEvent(job, dispute.by, 'disputed', dispute.note)
  addSettlementEvent(job, 'disputed', dispute.note)
  return dispute
}

export async function assessDisputeWithAi(job: Job, reviewer: ReviewCompletion = complete, collectArtifacts: ArtifactCollector = collectReviewArtifacts): Promise<Review> {
  ensureStatus(job, ['disputed'], 'review dispute for')
  if (!job.submission) fail('worker submission is required')
  if (!activeDispute(job)) fail('no active dispute to review', 409)
  const review = await runAiReview(job, 'dispute', reviewer, collectArtifacts, { ignoreActiveDispute: true })
  job.review = review
  if (review.releaseEligible) {
    resolveActiveDispute(job, 'release', review.summary)
    releaseReviewedJob(job, 'agent', 'AI dispute review found the dispute unsupported and released escrow')
  } else if (review.recommendation === 'revision') {
    resolveActiveDispute(job, 'revision', review.revisionInstructions || review.summary)
    job.status = 'revision_requested'
    addSettlementEvent(job, 'reviewed', 'Dispute review requested worker revision')
    addEvent(job, 'agent', 'revision_requested', review.revisionInstructions || review.summary)
  } else {
    addSettlementEvent(job, 'reviewed', 'Dispute review could not safely settle the escrow')
    addEvent(job, 'agent', 'dispute_reviewed', review.summary)
  }
  return job.review
}

export function autoReleaseExpiredJobs(at = new Date()): number {
  let released = 0
  for (const job of jobs.values()) {
    if (job.settlement.mode === 'devnet-escrow') continue
    if (!['submitted', 'revision_requested'].includes(job.status)) continue
    const deadline = job.review?.autoReleaseAt || (job.review?.releaseEligible ? deadlineFrom(job.review.at) : '')
    if (!job.review?.releaseEligible || !deadline || activeDispute(job)) continue
    if (new Date(deadline).getTime() > at.getTime()) continue
    job.review.autoReleaseAt = deadline
    releaseReviewedJob(job, 'system', 'Auto-released after the employer dispute window expired')
    released += 1
  }
  return released
}
