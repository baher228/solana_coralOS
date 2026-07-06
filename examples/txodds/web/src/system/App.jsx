import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_JOB_BRIEF, EMPTY_MCP_SESSION, EMPTY_RUNNER, SCRIPT, CORAL_BUS } from './config.js'
import { api } from './client.js'
import { cameraNodes, focusCamera, graphDebugEnabled, recordGraphDebug } from './camera.js'
import { makeGraph } from './graph.js'
import {
  jobAwareStep,
  jobById,
  jobPostBody,
  latestCoralPanelJob,
  liveSnapshot,
  liveStepIndex,
  newest,
  normalizeJobBrief,
} from './jobs.js'
import { DemoGuidePanel } from './components/GuidePanel.jsx'
import {
  CoralPanelStatus,
  JobSetup,
  LiveAgentRun,
  LiveFacts,
  McpAgentDemo,
  ProofList,
} from './components/SidePanels.jsx'
import { SystemMap } from './components/SystemMap.jsx'
import { StepSummary, Topbar } from './components/Topbar.jsx'

export function App() {
  const flowRef = useRef(null)
  const lastCameraKey = useRef('')
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [demoJob, setDemoJob] = useState(DEFAULT_JOB_BRIEF)
  const [jobDraft, setJobDraft] = useState(DEFAULT_JOB_BRIEF)
  const [backendJobId, setBackendJobId] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [jobError, setJobError] = useState('')
  const [jobBriefOpen, setJobBriefOpen] = useState(true)
  const [guideStarted, setGuideStarted] = useState(false)
  const [briefConfirmed, setBriefConfirmed] = useState(false)
  const [guideBusy, setGuideBusy] = useState(false)
  const [guideError, setGuideError] = useState('')
  const [liveEnabled, setLiveEnabled] = useState(true)
  const [liveData, setLiveData] = useState({ jobs: [], agents: [], summary: {} })
  const [liveError, setLiveError] = useState('')
  const [busHealth, setBusHealth] = useState(null)
  const [busError, setBusError] = useState('')
  const [runner, setRunner] = useState(EMPTY_RUNNER)
  const [runnerBusy, setRunnerBusy] = useState(false)
  const [runnerError, setRunnerError] = useState('')
  const [mcpSession, setMcpSession] = useState(EMPTY_MCP_SESSION)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [followLive, setFollowLive] = useState(false)
  const [followMcp, setFollowMcp] = useState(false)

  const live = liveSnapshot(liveData)
  const trackedJobId = followMcp ? mcpSession.jobId : runner.jobId
  const runJob = jobById(liveData, trackedJobId) || (followLive || followMcp ? live.job : null)
  const runnerJob = jobById(liveData, runner.jobId)
  const backendJob = jobById(liveData, backendJobId)
  const panelJob = backendJob?.review?.source === 'coral-panel' ? backendJob : latestCoralPanelJob(liveData.jobs)
  const guideJob = backendJob || jobById(liveData, mcpSession.jobId) || runnerJob || panelJob
  const guidePanelJob = guideJob?.review?.source === 'coral-panel' ? guideJob : panelJob
  const progress = followMcp ? { steps: mcpSession.steps } : runner
  const inferredRunJob = runJob || guideJob
  const showLiveProgress = followLive || followMcp || (!guideStarted && Boolean(inferredRunJob))
  const activeStepIndex = showLiveProgress ? liveStepIndex(progress, inferredRunJob) : stepIndex
  const step = useMemo(
    () => jobAwareStep(SCRIPT[activeStepIndex] || SCRIPT[0], demoJob),
    [activeStepIndex, demoJob],
  )
  const metrics = liveEnabled && showLiveProgress ? { ...step.metrics, ...live.metrics } : step.metrics
  const activeCameraNodes = useMemo(() => cameraNodes(step.id), [step.id])
  const activeCameraKey = activeCameraNodes.join(',')
  const activeRequiredNodes = useMemo(
    () => step.active?.length ? step.active : activeCameraNodes,
    [step.id, activeCameraKey],
  )
  const activeRequiredKey = activeRequiredNodes.join(',')
  const mcpAgentConnected = Boolean(mcpSession.steps?.connected)
  const mcpAgentProgress = Boolean(mcpSession.steps?.bidPlaced || mcpSession.steps?.deliverySubmitted)
  const guideHasBackendJob = Boolean(guideJob)
  const guideHasAgentProgress = Boolean(
    mcpAgentProgress
    || runner.jobId
    || runner.running
    || guideJob?.marketplace?.bids?.length
    || guideJob?.marketplace?.awardedBid
    || guideJob?.worker,
  )
  const progressGuideTitle = showLiveProgress ? `Watch ${step.title.toLowerCase()}` : 'Watch marketplace progress'
  const progressGuideDetail = showLiveProgress
    ? `Live step ${activeStepIndex + 1} of ${SCRIPT.length}: ${step.copy}`
    : guideJob?.submission ? 'Delivery evidence was submitted.' : 'Wait for bid, award, escrow funding, and delivery.'
  const guideSteps = [
    { id: 'start', index: 1, title: 'Start clean demo', detail: guideStarted ? 'Local demo state is ready.' : 'Clear old local jobs before evaluating.', done: guideStarted || guideHasBackendJob },
    { id: 'brief', index: 2, title: 'Fill job brief', detail: 'Review or edit the task details in this window.', done: (guideStarted || guideHasBackendJob) && (briefConfirmed || guideHasBackendJob) },
    { id: 'post', index: 3, title: 'Post real backend job', detail: guideJob ? `Backend ${guideJob.id}` : 'Create an open marketplace task.', done: guideHasBackendJob },
    { id: 'agent', index: 4, title: mcpSession.authorizationHeader ? 'AI agent MCP setup' : 'Choose AI agent path', detail: mcpSession.authorizationHeader ? (mcpAgentConnected ? 'Agent connected. Keep this prompt open until it bids or use the bundled worker.' : 'Copy the MCP prompt into your AI agent, then refresh after it calls the tools.') : runner.jobId ? 'Bundled worker is running.' : 'Use any MCP-capable agent or the bundled worker.', done: guideHasAgentProgress },
    { id: 'delivery', index: 5, title: progressGuideTitle, detail: progressGuideDetail, done: Boolean(guideJob?.submission) },
    { id: 'panel', index: 6, title: 'Watch Coral panel', detail: guidePanelJob?.settlement?.release ? 'Settlement released.' : guidePanelJob?.review?.panel?.verdict ? 'Referee verdict received.' : 'Artifacts, advocate opinions, and referee verdict appear here.', done: Boolean(guidePanelJob?.review?.panel?.verdict || guidePanelJob?.settlement?.release || guidePanelJob?.settlement?.refund) },
  ]
  const activeGuideStep = guideSteps.find((item) => !item.done) || guideSteps[guideSteps.length - 1]
  const desiredCameraKey = `${activeStepIndex}:${step.id}:${activeCameraKey}:${activeRequiredKey}:${activeGuideStep.id}`

  const setDraft = (key) => (e) => {
    setBriefConfirmed(false)
    setJobDraft((current) => ({ ...current, [key]: e.target.value }))
  }
  const confirmBrief = () => {
    const next = normalizeJobBrief(jobDraft)
    setDemoJob(next)
    setJobDraft(next)
    setBriefConfirmed(true)
    setJobBriefOpen(true)
    setFollowLive(false)
    setFollowMcp(false)
    setPlaying(false)
    setStepIndex(0)
  }
  const applyJobDraft = async () => {
    const next = normalizeJobBrief(jobDraft)
    setJobBusy(true)
    setJobError('')
    setLiveEnabled(true)
    try {
      const state = await api('/api/jobs', jobPostBody(next))
      const created = state.createdJob || newest(state.jobs || [])
      setDemoJob(next)
      setJobDraft(next)
      setBriefConfirmed(true)
      setBackendJobId(created?.id || '')
      setLiveData(state)
      setJobBriefOpen(true)
      setGuideStarted(true)
      setFollowLive(false)
      setFollowMcp(false)
      setPlaying(false)
      setStepIndex(0)
    } catch (e) {
      setJobError(e.message || String(e))
    } finally {
      setJobBusy(false)
    }
  }

  const refreshLive = async (force = false) => {
    if (!force && !liveEnabled) return
    setLiveError('')
    try {
      setLiveData(await api('/api/platform'))
    } catch (e) {
      setLiveError(e.message || String(e))
    }
  }

  const refreshBus = async () => {
    setBusError('')
    try {
      const healthPath = CORAL_BUS ? `${CORAL_BUS}/health` : '/api/coral/health'
      const res = await fetch(healthPath, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      setBusHealth(data)
    } catch (e) {
      setBusHealth(null)
      setBusError(e.message || String(e))
    }
  }

  const refreshRunner = async () => {
    setRunnerError('')
    try {
      setRunner(await api('/api/demo/agent-run'))
    } catch (e) {
      setRunnerError(e.message || String(e))
    }
  }

  const refreshMcp = async () => {
    setMcpError('')
    try {
      const next = await api('/api/demo/mcp-session')
      setMcpSession((current) => ({ ...current, ...next }))
    } catch (e) {
      setMcpError(e.message || String(e))
    }
  }

  const refreshDemoState = async () => {
    await Promise.all([refreshLive(true), refreshRunner(), refreshMcp(), refreshBus()])
  }

  const startGuidedDemo = async () => {
    setGuideBusy(true)
    setGuideError('')
    setPlaying(false)
    setFollowLive(false)
    setFollowMcp(false)
    setLiveEnabled(true)
    try {
      const state = await api('/api/demo/reset', {})
      setLiveData(state)
      setRunner(state.demo || EMPTY_RUNNER)
      setMcpSession(state.mcp || EMPTY_MCP_SESSION)
      setDemoJob(DEFAULT_JOB_BRIEF)
      setJobDraft(DEFAULT_JOB_BRIEF)
      setBackendJobId('')
      setJobError('')
      setMcpError('')
      setRunnerError('')
      setJobBriefOpen(true)
      setGuideStarted(true)
      setBriefConfirmed(false)
      setStepIndex(0)
      await refreshBus()
    } catch (e) {
      setGuideError(e.message || String(e))
    } finally {
      setGuideBusy(false)
    }
  }

  const startFreshMcpDemo = async () => {
    setGuideBusy(true)
    setGuideError('')
    setJobError('')
    setMcpError('')
    setRunnerError('')
    setPlaying(false)
    setFollowLive(false)
    setFollowMcp(false)
    setLiveEnabled(true)
    try {
      await api('/api/demo/reset', {})
      const next = await api('/api/demo/mcp-session', { restart: true })
      const freshJob = next.job || {}
      const brief = normalizeJobBrief({
        employer: freshJob.employer || DEFAULT_JOB_BRIEF.employer,
        title: freshJob.title || DEFAULT_JOB_BRIEF.title,
        budgetSol: String(freshJob.marketplace?.budgetSol || freshJob.amountSol || DEFAULT_JOB_BRIEF.budgetSol),
        scope: freshJob.scope || DEFAULT_JOB_BRIEF.scope,
        acceptanceCriteria: freshJob.acceptanceCriteria || DEFAULT_JOB_BRIEF.acceptanceCriteria,
      })
      setRunner(EMPTY_RUNNER)
      setMcpSession(next)
      setBackendJobId(next.jobId || '')
      setDemoJob(brief)
      setJobDraft(brief)
      setJobBriefOpen(true)
      setGuideStarted(true)
      setBriefConfirmed(true)
      setStepIndex(0)
      await Promise.all([refreshLive(true), refreshBus()])
    } catch (e) {
      setGuideError(e.message || String(e))
    } finally {
      setGuideBusy(false)
    }
  }

  const startRunner = async () => {
    setRunnerBusy(true)
    setRunnerError('')
    setLiveEnabled(true)
    setFollowLive(true)
    setFollowMcp(false)
    setPlaying(false)
    try {
      const brief = normalizeJobBrief(jobDraft)
      const input = backendJobId
        ? { jobId: backendJobId, restart: true, reviewMode: 'coral-panel' }
        : { ...jobPostBody(brief), restart: true, reviewMode: 'coral-panel' }
      const next = await api('/api/demo/agent-run', input)
      setRunner(next)
      setBackendJobId(next.jobId || backendJobId)
      setDemoJob(brief)
      setJobDraft(brief)
      setGuideStarted(true)
      await refreshLive(true)
    } catch (e) {
      setRunnerError(e.message || String(e))
    } finally {
      setRunnerBusy(false)
    }
  }

  const startMcp = async () => {
    setMcpBusy(true)
    setMcpError('')
    setLiveEnabled(true)
    setFollowMcp(false)
    setFollowLive(false)
    setPlaying(false)
    try {
      const brief = normalizeJobBrief(jobDraft)
      const input = backendJobId ? { jobId: backendJobId } : jobPostBody(brief)
      const next = await api('/api/demo/mcp-session', input)
      setMcpSession(next)
      setBackendJobId(next.jobId || backendJobId)
      setDemoJob(brief)
      setJobDraft(brief)
      setGuideStarted(true)
      await refreshLive(true)
    } catch (e) {
      setMcpError(e.message || String(e))
    } finally {
      setMcpBusy(false)
    }
  }

  useEffect(() => {
    if (!guideStarted || !mcpAgentProgress) return
    if (graphDebugEnabled()) {
      console.info('[txodds-mcp-follow]', {
        reason: 'mcp-agent-progress',
        jobId: mcpSession.jobId,
        steps: mcpSession.steps,
        currentStep: step.id,
        activeGuideStep: activeGuideStep.id,
      })
      recordGraphDebug('mcp-follow:before-enable', activeCameraNodes, activeRequiredNodes, true)
    }
    setFollowMcp(true)
    setFollowLive(false)
    setPlaying(false)
  }, [guideStarted, mcpAgentProgress])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setStepIndex((current) => current >= SCRIPT.length - 1 ? 0 : current + 1)
    }, 1800)
    return () => clearInterval(timer)
  }, [playing])

  useEffect(() => {
    refreshLive()
    if (!liveEnabled && !followLive && !followMcp) return
    const timer = setInterval(refreshLive, followLive || followMcp ? 1500 : 5000)
    return () => clearInterval(timer)
  }, [liveEnabled, followLive, followMcp])

  useEffect(() => {
    refreshRunner()
    const timer = setInterval(refreshRunner, followLive || runner.running ? 1500 : 5000)
    return () => clearInterval(timer)
  }, [followLive, runner.running])

  useEffect(() => {
    refreshMcp()
    const timer = setInterval(refreshMcp, followMcp || mcpSession.active ? 1500 : 5000)
    return () => clearInterval(timer)
  }, [followMcp, mcpSession.active])

  useEffect(() => {
    refreshBus()
    const timer = setInterval(refreshBus, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!flowRef.current) return
    if (lastCameraKey.current === desiredCameraKey) return
    lastCameraKey.current = desiredCameraKey
    const timer = window.setTimeout(() => focusCamera(flowRef.current, activeCameraNodes, 'step', activeRequiredNodes), 80)
    return () => window.clearTimeout(timer)
  }, [activeCameraNodes, activeRequiredNodes, desiredCameraKey])

  useEffect(() => {
    const onResize = () => {
      if (flowRef.current) focusCamera(flowRef.current, activeCameraNodes, 'resize', activeRequiredNodes)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeCameraNodes, activeRequiredNodes])

  const graph = useMemo(() => makeGraph(step, demoJob), [step, demoJob])
  const centerMap = () => {
    setPlaying(false)
    lastCameraKey.current = ''
    if (flowRef.current) focusCamera(flowRef.current, activeCameraNodes, 'manual', activeRequiredNodes)
  }
  const nextStep = () => {
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex((current) => Math.min(SCRIPT.length - 1, current + 1))
  }
  const reset = () => {
    setPlaying(false)
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex(0)
  }
  const setLiveEnabledChecked = (checked) => {
    setLiveEnabled(checked)
    if (!checked) {
      setFollowLive(false)
      setFollowMcp(false)
    }
  }

  return (
    <main className="system-shell">
      <Topbar
        playing={playing}
        liveEnabled={liveEnabled}
        stepIndex={stepIndex}
        totalSteps={SCRIPT.length}
        onTogglePlay={() => { setFollowLive(false); setFollowMcp(false); setPlaying(!playing) }}
        onNextStep={nextStep}
        onReset={reset}
        onLiveEnabled={setLiveEnabledChecked}
        onCenterMap={centerMap}
        onRefresh={refreshLive}
      />
      <StepSummary
        followLive={followLive}
        followMcp={followMcp}
        activeStepIndex={activeStepIndex}
        totalSteps={SCRIPT.length}
        step={step}
        script={SCRIPT}
      />
      <SystemMap
        graph={graph}
        metrics={metrics}
        onJobNodeClick={() => setJobBriefOpen(true)}
        onInit={(instance) => {
          flowRef.current = instance
          window.setTimeout(() => focusCamera(instance, activeCameraNodes, 'init', activeRequiredNodes), 80)
        }}
      />
      <DemoGuidePanel
        steps={guideSteps}
        activeStep={activeGuideStep}
        draft={jobDraft}
        job={demoJob}
        backendJob={backendJob}
        panelJob={panelJob}
        mcpSession={mcpSession}
        wallets={liveData.setup?.wallets}
        busy={guideBusy || jobBusy || mcpBusy || runnerBusy}
        error={guideError || jobError || mcpError || runnerError}
        onDraft={setDraft}
        onStart={startGuidedDemo}
        onConfirmBrief={confirmBrief}
        onPostJob={applyJobDraft}
        onStartFreshMcp={startFreshMcpDemo}
        onCreateMcp={startMcp}
        onRunWorker={startRunner}
        onRefresh={refreshDemoState}
      />
      <aside className="system-side">
        <JobSetup
          job={demoJob}
          backendJob={backendJob}
          error={jobError}
          active={activeGuideStep.id === 'brief' || activeGuideStep.id === 'post'}
          briefOpen={jobBriefOpen}
          onToggleBrief={() => setJobBriefOpen((open) => !open)}
        />
        <McpAgentDemo session={mcpSession} job={jobById(liveData, mcpSession.jobId) || backendJob} brief={demoJob} busy={mcpBusy} error={mcpError} active={activeGuideStep.id === 'agent'} onStart={startMcp} onRefresh={refreshMcp} />
        <LiveAgentRun runner={runner} job={runnerJob || backendJob} busy={runnerBusy} error={runnerError} active={activeGuideStep.id === 'delivery'} onStart={startRunner} onRefresh={refreshRunner} />
        <CoralPanelStatus job={panelJob} bus={busHealth} error={busError} active={activeGuideStep.id === 'panel'} onRefresh={refreshBus} />
        <LiveFacts data={liveData} enabled={liveEnabled} error={liveError} />
        <ProofList />
      </aside>
    </main>
  )
}
