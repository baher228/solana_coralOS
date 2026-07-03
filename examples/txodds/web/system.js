import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import htm from 'htm'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Copy,
  DatabaseZap,
  ExternalLink,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  Settings,
  ShieldCheck,
  StepForward,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API
  ?? window.FREELANCE_ESCROW_API
  ?? (location.port === '3021' ? 'http://localhost:8802' : 'http://localhost:8801')

const SPEEDS = [1, 1.5, 2, 0.5]

const DEFAULT_KEYS = { play: ' ', step: 'ArrowRight', back: 'ArrowLeft', reset: 'r' }

const SCRIPT = [
  {
    id: 'post',
    title: 'Employer posts task',
    copy: 'A scoped job enters the open market with budget, acceptance criteria, and escrow terms.',
    metrics: { budget: '0.003 SOL', bid: '--', escrow: 'not funded', review: 'not run', settlement: '--' },
    active: ['employer', 'job'],
  },
  {
    id: 'feed',
    title: 'Agent network sees it',
    copy: 'Connected agents use the platform MCP server or REST API with their own service-account token.',
    metrics: { budget: '0.003 SOL', bid: '--', escrow: 'not funded', review: 'not run', settlement: '--' },
    active: ['feed'],
    complete: ['employer', 'job'],
  },
  {
    id: 'bid',
    title: 'Agents bid',
    copy: 'Worker agents submit wallet-backed bids. The platform validates price cap, wallet, identity, and duplicate awards.',
    metrics: { budget: '0.003 SOL', bid: '3 bids received', escrow: 'not funded', review: 'not run', settlement: '--' },
    active: ['bid'],
    complete: ['employer', 'job', 'feed'],
  },
  {
    id: 'award',
    title: 'Auctioneer awards',
    copy: 'After the bid window, the backend awards the cheapest valid bid and records the selected agent as the worker.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'opening', review: 'not run', settlement: '--' },
    active: ['auctioneer'],
    complete: ['employer', 'job', 'feed', 'bid'],
  },
  {
    id: 'escrow',
    title: 'Devnet escrow funds',
    copy: 'The awarded bid amount is deposited into devnet escrow. Agent jobs cannot bypass escrow.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'deposit sig', review: 'not run', settlement: '--' },
    active: ['escrow'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer'],
  },
  {
    id: 'delivery',
    title: 'Worker agent delivers',
    copy: 'The agent submits preview URL, repo, and notes. The platform attaches the evidence to the funded contract.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'queued', settlement: '--' },
    active: ['delivery'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow'],
  },
  {
    id: 'review',
    title: 'Escrow review runs',
    copy: 'Artifact and AI gates inspect the delivery. Fallback or unavailable review cannot release funds.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'pass', settlement: 'pending window' },
    active: ['review'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery'],
  },
  {
    id: 'release',
    title: 'Funds release',
    copy: 'After review gates pass and the dispute window expires, escrow releases funds to the worker agent wallet.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'pass', settlement: 'release sig' },
    active: ['settlement'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery', 'review'],
  },
]

// Swimlanes: [name, xStart, xEnd, tone]. Bands live in flow space so they pan/zoom with the graph.
const LANES = [
  ['Marketplace', 0, 520, 'paper'],
  ['Agent Network', 520, 1320, 'green'],
  ['Escrow', 1320, 1600, 'gold'],
  ['Review', 1600, 2140, 'mint'],
  ['Settlement', 2140, 2420, 'gold'],
]
const LANE_TOP = 20
const LANE_HEIGHT = 380

// [id, x, y, lane, icon, title, meta, detail]
const BASE_NODES = [
  ['employer', 40, 70, 'Marketplace', UserRound, 'Employer', 'Posts scoped work', 'Budget, criteria, milestones'],
  ['job', 290, 70, 'Marketplace', BriefcaseBusiness, 'Open Job', 'Public task listing', 'Available to humans and agents'],
  ['feed', 560, 70, 'Agent Network', DatabaseZap, 'Agent Feed', 'Polling API', 'Tokens identify each agent'],
  ['bid', 810, 70, 'Agent Network', CircleDollarSign, 'Bid Window', 'Wallet-backed bids', 'Cheapest valid bid wins'],
  ['auctioneer', 1060, 70, 'Agent Network', Scale, 'Auctioneer', 'Backend allocator', 'Awards once, blocks duplicates'],
  ['escrow', 1360, 70, 'Escrow', Wallet, 'Devnet Escrow', 'Mandatory funding', 'Buyer deposits final bid amount'],
  ['delivery', 1640, 70, 'Review', Bot, 'Worker Agent', 'Delivery evidence', 'URL, repo, and notes'],
  ['review', 1890, 70, 'Review', ShieldCheck, 'Escrow Review', 'Artifact + AI gates', 'No release on fallback review'],
  ['settlement', 2180, 70, 'Settlement', CheckCircle2, 'Settlement', 'Release or refund', 'Payout/refund signatures'],
  ['human', 165, 250, 'Marketplace', UserRound, 'Human Worker', 'Manual claim path', 'Still supported for normal jobs'],
  ['coral', 685, 250, 'Agent Network', GitBranch, 'Coral Adapter', 'Optional bridge', 'Coral is one connector, not the platform'],
]

const EDGES = [
  ['e1', 'employer', 'job'],
  ['e2', 'job', 'feed'],
  ['e3', 'feed', 'bid'],
  ['e4', 'bid', 'auctioneer'],
  ['e5', 'auctioneer', 'escrow'],
  ['e6', 'escrow', 'delivery'],
  ['e7', 'delivery', 'review'],
  ['e8', 'review', 'settlement'],
  ['e9', 'job', 'human'],
  ['e10', 'feed', 'coral'],
]

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — customisation just won't persist */
  }
}

function normalizeKey(key) {
  return key.length === 1 ? key.toLowerCase() : key
}

function keyLabel(key) {
  if (!key) return 'unset'
  const map = { ' ': 'Space', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓' }
  if (map[key]) return map[key]
  return key.length === 1 ? key.toUpperCase() : key
}

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function short(value) {
  if (!value) return '--'
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function newest(jobs) {
  return [...jobs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
}

function latestAgentJob(jobs) {
  return newest(jobs.filter((job) => job.marketplace || job.settlement?.mode === 'devnet-escrow')) || newest(jobs)
}

function jobById(data, id) {
  return id ? (data.jobs || []).find((job) => job.id === id) : null
}

function liveSnapshot(data) {
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
      review: job?.review?.source || '--',
      settlement: job?.settlement?.release ? short(job.settlement.release) : job?.settlement?.refund ? short(job.settlement.refund) : '--',
    },
  }
}

function liveStepIndex(runner, job) {
  if (job?.settlement?.release || job?.settlement?.refund) return 7
  if (job?.review || runner.steps?.reviewCaptured) return 6
  if (job?.submission || runner.steps?.deliverySubmitted) return 5
  if (job?.settlement?.devnet?.deposit || runner.steps?.funded) return 4
  if (job?.marketplace?.awardedBid || runner.steps?.awarded) return 3
  if (job?.marketplace?.bids?.length || runner.steps?.bidPlaced) return 2
  if (job || runner.steps?.jobPosted) return 1
  return 0
}

function nodeStatus(id, step) {
  if (step.active?.includes(id)) return 'active'
  if (step.complete?.includes(id)) return 'complete'
  return 'idle'
}

function edgeActive(source, target, step) {
  return [...(step.active || []), ...(step.complete || [])].includes(source)
    && [...(step.active || []), ...(step.complete || [])].includes(target)
}

function laneNodesList() {
  return LANES.map(([label, x0, x1, tone]) => ({
    id: `lane-${label}`,
    type: 'lane',
    position: { x: x0, y: LANE_TOP },
    data: { label, tone },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    zIndex: 0,
    style: { width: x1 - x0, height: LANE_HEIGHT },
  }))
}

// Saved positions override the defaults so a dragged layout survives a reload.
function systemNodesList(savedPos) {
  return BASE_NODES.map(([id, x, y, lane, icon, title, meta, detail]) => ({
    id,
    type: 'system',
    zIndex: 1,
    position: savedPos && savedPos[id] ? { x: savedPos[id].x, y: savedPos[id].y } : { x, y },
    data: { icon, title, meta, detail, lane, state: nodeStatus(id, SCRIPT[0]) },
  }))
}

function buildEdges(step) {
  return EDGES.map(([id, source, target]) => ({
    id,
    source,
    target,
    type: 'smoothstep',
    animated: edgeActive(source, target, step),
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edgeActive(source, target, step) ? 'flow-edge-active' : 'flow-edge-idle',
  }))
}

function BrandMark() {
  return html`<span className="brand-mark" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <path d="M9.4 14.4 13 9.6M9.4 17.6 13 22.4M19 9.6 22.6 14.4M19 22.4 22.6 17.6" stroke="rgba(247,241,231,.34)" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="7" cy="16" r="2.6" fill="#91a782" />
      <circle cx="16" cy="8" r="2.6" fill="#91a782" />
      <circle cx="16" cy="24" r="2.6" fill="#91a782" />
      <circle cx="25" cy="16" r="3" fill="#d3a34a" />
    </svg>
  </span>`
}

function SettingsPopover({ innerRef, bindings, listeningFor, onListen, onResetKeys, onResetPositions, onClose }) {
  const rows = [['play', 'Play / Pause'], ['step', 'Step forward'], ['back', 'Step back'], ['reset', 'Reset']]
  return html`<div className="settings-pop" ref=${innerRef}>
    <div className="settings-head">
      <span>Shortcuts</span>
      <button className="icon-btn sm" onClick=${onClose} title="Close"><${X} size=${14} /></button>
    </div>
    <div className="kb-rows">
      ${rows.map(([action, label]) => html`<div className="kb-row" key=${action}>
        <span>${label}</span>
        <button className=${`kb-key${listeningFor === action ? ' listening' : ''}`} onClick=${() => onListen(action)}>
          ${listeningFor === action ? 'Press a key' : keyLabel(bindings[action])}
        </button>
      </div>`)}
    </div>
    <div className="settings-actions">
      <button onClick=${onResetKeys}>Reset shortcuts</button>
      <button onClick=${onResetPositions}>Reset node layout</button>
    </div>
    <p className="settings-hint">Click a shortcut, then press the new key. Esc cancels. Drag nodes on the map to rearrange; reset the layout above.</p>
  </div>`
}

function LaneNode({ data }) {
  return html`<div className="lane-node" data-tone=${data.tone}>
    <span className="lane-label">${data.label}</span>
  </div>`
}

function SystemNode({ data }) {
  const Icon = data.icon
  return html`<div className=${`system-node ${data.state}`} data-lane=${data.lane}>
    <${Handle} type="target" position=${Position.Left} />
    <div className="node-head">
      <span className="node-icon"><${Icon} size=${17} /></span>
      <b>${data.title}</b>
    </div>
    <p>${data.meta}</p>
    <small>${data.detail}</small>
    <${Handle} type="source" position=${Position.Right} />
  </div>`
}

function Metric({ label, value }) {
  return html`<div className="system-metric"><span>${label}</span><b>${value}</b></div>`
}

function StepChips({ steps }) {
  return html`<div className="system-run-steps">
    ${steps.map(([label, done]) => html`<span key=${label} className=${done ? 'done' : ''}>${label}</span>`)}
  </div>`
}

function McpBody({ session, job, busy, error, onStart }) {
  const previewUrl = job?.submission?.url || session.previewUrl
  const setup = session.setup || `MCP_URL=${session.mcpUrl || `${API}/mcp`}\nMCP_AUTH_HEADER=Authorization: Bearer <start demo to mint key>`
  const copySetup = () => navigator.clipboard?.writeText(setup)
  const steps = [
    ['Key', session.steps?.registered],
    ['Job', session.steps?.jobPosted || Boolean(job)],
    ['OpenClaw', session.steps?.connected],
    ['Bid', session.steps?.bidPlaced || Boolean(job?.marketplace?.bids?.length)],
    ['Award', session.steps?.awarded || Boolean(job?.marketplace?.awardedBid)],
    ['Escrow', session.steps?.funded || Boolean(job?.settlement?.devnet?.deposit)],
    ['Delivery', session.steps?.deliverySubmitted || Boolean(job?.submission)],
    ['Review', session.steps?.reviewCaptured || Boolean(job?.review)],
  ]
  return html`<div className="run-body">
    <div className="system-run-actions">
      <button className="run-primary" onClick=${onStart} disabled=${busy}><${Play} size=${15} />${busy ? 'Starting' : session.active ? 'Show MCP setup' : 'Start MCP demo'}</button>
      <div className="run-actions-row">
        <button onClick=${copySetup} disabled=${!session.setup}><${Copy} size=${14} />Copy setup</button>
        ${previewUrl
          ? html`<a className="system-run-link" href=${previewUrl} target="_blank" rel="noreferrer"><${ExternalLink} size=${14} />Agent build</a>`
          : html`<button disabled><${ExternalLink} size=${14} />Agent build</button>`}
      </div>
    </div>
    <pre className="system-mcp-setup">${setup}</pre>
    <${StepChips} steps=${steps} />
    <dl>
      <div><dt>Job</dt><dd>${job?.title || session.jobId || '--'}</dd></div>
      <div><dt>Status</dt><dd>${job?.status || '--'}</dd></div>
      <div><dt>Agent</dt><dd>${session.agentName || '--'}</dd></div>
      <div><dt>Last MCP call</dt><dd>${session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleTimeString() : '--'}</dd></div>
    </dl>
    ${error || session.error ? html`<p className="system-error small">${error || session.error}</p>` : null}
    ${session.events?.length ? html`<div className="system-run-log">
      ${session.events.slice(0, 5).map((line) => html`<small key=${line}>${line}</small>`)}
    </div>` : null}
  </div>`
}

function LiveBody({ runner, job, busy, error, onStart }) {
  const previewUrl = job?.submission?.url || runner.previewUrl
  const steps = [
    ['Agent', runner.steps?.agentStarted || runner.running],
    ['Job', runner.steps?.jobPosted || Boolean(job)],
    ['Bid', runner.steps?.bidPlaced || Boolean(job?.marketplace?.bids?.length)],
    ['Award', runner.steps?.awarded || Boolean(job?.marketplace?.awardedBid)],
    ['Build', runner.steps?.buildServed || Boolean(previewUrl)],
    ['Review', runner.steps?.reviewCaptured || Boolean(job?.review)],
  ]
  return html`<div className="run-body">
    <div className="system-run-actions">
      <button className="run-primary" onClick=${onStart} disabled=${busy}><${Play} size=${15} />${busy ? 'Starting' : runner.jobId ? 'Resume live run' : 'Run live agent demo'}</button>
      <div className="run-actions-row">
        ${previewUrl
          ? html`<a className="system-run-link" href=${previewUrl} target="_blank" rel="noreferrer"><${ExternalLink} size=${14} />Agent build</a>`
          : html`<button disabled><${ExternalLink} size=${14} />Agent build</button>`}
      </div>
    </div>
    <${StepChips} steps=${steps} />
    ${job ? html`<dl>
      <div><dt>Job</dt><dd>${job.title}</dd></div>
      <div><dt>Status</dt><dd>${job.status}</dd></div>
      <div><dt>Agent</dt><dd>${runner.agentName || '--'}</dd></div>
    </dl>` : null}
    ${error || runner.error ? html`<p className="system-error small">${error || runner.error}</p>` : null}
    ${runner.logs?.length ? html`<div className="system-run-log">
      ${runner.logs.slice(-4).map((line) => html`<small key=${line}>${line}</small>`)}
    </div>` : null}
  </div>`
}

function RunDemo({ tab, onTab, mcp, live }) {
  const status = tab === 'mcp'
    ? (mcp.session.active ? (mcp.session.steps?.connected ? 'Connected' : 'Key ready') : 'Idle')
    : (live.runner.running ? 'Running' : live.runner.jobId ? 'Started' : 'Idle')
  const onRefresh = tab === 'mcp' ? mcp.onRefresh : live.onRefresh
  return html`<section className="system-run">
    <div className="system-run-head">
      <div><span>Run demo</span><b>${status}</b></div>
      <button className="icon-btn" onClick=${onRefresh} title="Refresh"><${RefreshCw} size=${15} /></button>
    </div>
    <div className="run-tabs" role="tablist">
      <button role="tab" aria-selected=${tab === 'mcp'} className=${tab === 'mcp' ? 'on' : ''} onClick=${() => onTab('mcp')}>MCP agent</button>
      <button role="tab" aria-selected=${tab === 'live'} className=${tab === 'live' ? 'on' : ''} onClick=${() => onTab('live')}>Live agent</button>
    </div>
    ${tab === 'mcp'
      ? html`<${McpBody} session=${mcp.session} job=${mcp.job} busy=${mcp.busy} error=${mcp.error} onStart=${mcp.onStart} />`
      : html`<${LiveBody} runner=${live.runner} job=${live.job} busy=${live.busy} error=${live.error} onStart=${live.onStart} />`}
  </section>`
}

function NetworkStatus({ data, enabled, error }) {
  const { job, agents } = liveSnapshot(data)
  return html`<section className="system-live">
    <div><span>Network status</span><b className=${enabled ? 'live-on' : ''}>${enabled ? 'Live' : 'Static'}</b></div>
    ${error ? html`<p className="system-error small">${error}</p>` : null}
    <dl>
      <div><dt>Latest job</dt><dd>${job?.title || 'No job loaded'}</dd></div>
      <div><dt>Status</dt><dd>${job?.status || '--'}</dd></div>
      <div><dt>Awarded</dt><dd>${job?.marketplace?.awardedBid?.by || '--'}</dd></div>
      <div><dt>Active agents</dt><dd>${agents.filter((agent) => agent.status === 'active').length}</dd></div>
    </dl>
  </section>`
}

function ProofPanel() {
  const [open, setOpen] = useState(false)
  const points = [
    'Any MCP-capable agent can connect with a platform token.',
    'Bids are permissioned and wallet-backed.',
    'The backend awards automatically.',
    'Escrow is mandatory for agent work.',
    'Review gates settlement.',
  ]
  return html`<section className=${`system-proof${open ? ' open' : ''}`}>
    <button className="proof-toggle" onClick=${() => setOpen((v) => !v)} aria-expanded=${open}>
      <span>What this proves</span>
      <${ChevronDown} size=${16} />
    </button>
    ${open ? html`<ul>
      ${points.map((point) => html`<li key=${point}>${point}</li>`)}
    </ul>` : null}
  </section>`
}

function App() {
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [liveData, setLiveData] = useState({ jobs: [], agents: [], summary: {} })
  const [liveError, setLiveError] = useState('')
  const [runner, setRunner] = useState({ running: false, agentName: 'demo-worker-live', logs: [], steps: {} })
  const [runnerBusy, setRunnerBusy] = useState(false)
  const [runnerError, setRunnerError] = useState('')
  const [mcpSession, setMcpSession] = useState({ active: false, agentName: 'openclaw-mcp-demo', mcpUrl: `${API}/mcp`, events: [], steps: {} })
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [followLive, setFollowLive] = useState(false)
  const [followMcp, setFollowMcp] = useState(false)
  const [selected, setSelected] = useState(null)
  const [runTab, setRunTab] = useState('mcp')

  // remappable keyboard shortcuts (persisted)
  const [bindings, setBindings] = useState(() => ({ ...DEFAULT_KEYS, ...loadJSON('agentnet.keys', {}) }))
  const [listeningFor, setListeningFor] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // React Flow owns node positions so a dragged process box stays put across steps
  const [nodes, setNodes, onNodesChange] = useNodesState(
    useMemo(() => [...laneNodesList(), ...systemNodesList(loadJSON('agentnet.nodepos', {}))], []),
  )

  const settingsWrapRef = useRef(null)
  const bindingsRef = useRef(bindings)
  const listeningRef = useRef(listeningFor)
  const actionsRef = useRef({})
  bindingsRef.current = bindings
  listeningRef.current = listeningFor

  const live = liveSnapshot(liveData)
  const trackedJobId = followMcp ? mcpSession.jobId : runner.jobId
  const runJob = jobById(liveData, trackedJobId) || (followLive || followMcp ? live.job : null)
  const runnerJob = jobById(liveData, runner.jobId)
  const progress = followMcp ? { steps: mcpSession.steps } : runner
  const following = followLive || followMcp
  const activeStepIndex = following ? liveStepIndex(progress, runJob) : stepIndex
  const step = SCRIPT[activeStepIndex]
  const metrics = liveEnabled ? { ...step.metrics, ...live.metrics } : step.metrics
  const edges = useMemo(() => buildEdges(step), [step])

  const refreshLive = async (force = false) => {
    if (!force && !liveEnabled) return
    setLiveError('')
    try {
      setLiveData(await api('/api/platform'))
    } catch (e) {
      setLiveError(e.message || String(e))
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

  const startRunner = async () => {
    setRunTab('live')
    setRunnerBusy(true)
    setRunnerError('')
    setLiveEnabled(true)
    setFollowLive(true)
    setFollowMcp(false)
    setPlaying(false)
    try {
      setRunner(await api('/api/demo/agent-run', {}))
      await refreshLive(true)
    } catch (e) {
      setRunnerError(e.message || String(e))
    } finally {
      setRunnerBusy(false)
    }
  }

  const startMcp = async () => {
    setRunTab('mcp')
    setMcpBusy(true)
    setMcpError('')
    setLiveEnabled(true)
    setFollowMcp(true)
    setFollowLive(false)
    setPlaying(false)
    try {
      setMcpSession(await api('/api/demo/mcp-session', {}))
      await refreshLive(true)
    } catch (e) {
      setMcpError(e.message || String(e))
    } finally {
      setMcpBusy(false)
    }
  }

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setStepIndex((current) => current >= SCRIPT.length - 1 ? 0 : current + 1)
    }, Math.max(500, 1800 / speed))
    return () => clearInterval(timer)
  }, [playing, speed])

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

  const nodeTypes = useMemo(() => ({ system: SystemNode, lane: LaneNode }), [])
  const selectedNode = selected ? nodes.find((node) => node.id === selected.id) : null

  // recolour nodes on step change without touching their (possibly dragged) positions
  useEffect(() => {
    setNodes((nds) => nds.map((node) => (
      node.type === 'system' ? { ...node, data: { ...node.data, state: nodeStatus(node.id, step) } } : node
    )))
  }, [step, setNodes])

  // persist dragged process positions
  useEffect(() => {
    const map = {}
    nodes.forEach((node) => { if (node.type === 'system') map[node.id] = node.position })
    saveJSON('agentnet.nodepos', map)
  }, [nodes])

  useEffect(() => { saveJSON('agentnet.keys', bindings) }, [bindings])

  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e) => {
      if (settingsWrapRef.current && !settingsWrapRef.current.contains(e.target)) setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [settingsOpen])

  const togglePlay = () => { setFollowLive(false); setFollowMcp(false); setPlaying((p) => !p) }
  const nextStep = () => {
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex((current) => Math.min(SCRIPT.length - 1, current + 1))
  }
  const prevStep = () => {
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex((current) => Math.max(0, current - 1))
  }
  const jumpTo = (index) => {
    setPlaying(false)
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex(index)
  }
  const reset = () => {
    setPlaying(false)
    setFollowLive(false)
    setFollowMcp(false)
    setStepIndex(0)
    setSelected(null)
  }
  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])

  actionsRef.current = { play: togglePlay, step: nextStep, back: prevStep, reset }

  const assignBinding = (action, rawKey) => {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(rawKey)) return
    const kn = normalizeKey(rawKey)
    setBindings((b) => {
      const next = { ...b }
      for (const other of Object.keys(next)) if (next[other] === kn) next[other] = null
      next[action] = kn
      return next
    })
    setListeningFor(null)
  }

  const resetPositions = () => {
    setNodes((nds) => nds.map((node) => {
      if (node.type !== 'system') return node
      const base = BASE_NODES.find((entry) => entry[0] === node.id)
      return base ? { ...node, position: { x: base[1], y: base[2] } } : node
    }))
    saveJSON('agentnet.nodepos', {})
  }

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (listeningRef.current) {
        e.preventDefault()
        if (e.key === 'Escape') { setListeningFor(null); return }
        assignBinding(listeningRef.current, e.key)
        return
      }
      if (typing) return
      if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
      const kn = normalizeKey(e.key)
      const match = Object.keys(bindingsRef.current).find((a) => bindingsRef.current[a] && bindingsRef.current[a] === kn)
      if (match && actionsRef.current[match]) { e.preventDefault(); actionsRef.current[match]() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const stepLabel = String(activeStepIndex + 1).padStart(2, '0')
  const totalLabel = String(SCRIPT.length).padStart(2, '0')

  return html`<main className="system-shell">
    <header className="topbar">
      <div className="brand">
        <${BrandMark} />
        <div className="brand-text">
          <span className="eyebrow">Solana · Devnet escrow</span>
          <h1>Agent Network</h1>
        </div>
      </div>
      <div className="transport" role="group" aria-label="Playback">
        <button className="t-btn" onClick=${reset} title=${`Reset (${keyLabel(bindings.reset)})`}><${RotateCcw} size=${16} />Reset</button>
        <button className="t-btn" onClick=${prevStep} disabled=${!following && stepIndex === 0} title=${`Back (${keyLabel(bindings.back)})`}><${StepForward} size=${16} style=${{ transform: 'scaleX(-1)' }} /></button>
        <button className=${`t-btn primary${playing ? ' is-playing' : ''}`} onClick=${togglePlay} title=${`Play / Pause (${keyLabel(bindings.play)})`}><${playing ? Pause : Play} size=${16} />${playing ? 'Pause' : 'Play'}</button>
        <button className="t-btn" onClick=${nextStep} disabled=${!following && stepIndex === SCRIPT.length - 1} title=${`Step (${keyLabel(bindings.step)})`}><${StepForward} size=${16} />Step</button>
        <span className="t-sep" />
        <button className="t-btn t-speed" onClick=${cycleSpeed} title="Playback speed">${speed}×</button>
      </div>
      <div className="live-controls">
        <label className=${`switch${liveEnabled ? ' on' : ''}`}>
          <input type="checkbox" checked=${liveEnabled} onChange=${(e) => { setLiveEnabled(e.target.checked); if (!e.target.checked) { setFollowLive(false); setFollowMcp(false) } }} />
          Live data
        </label>
        <button className="ghost-btn" onClick=${() => refreshLive(true)} disabled=${!liveEnabled} title="Refresh live data"><${RefreshCw} size=${16} />Refresh</button>
        <div className="settings-wrap" ref=${settingsWrapRef}>
          <button className=${`ghost-btn icon-only${settingsOpen ? ' active' : ''}`} onClick=${() => setSettingsOpen((v) => !v)} title="Shortcuts" aria-label="Shortcuts"><${Settings} size=${16} /></button>
          ${settingsOpen ? html`<${SettingsPopover}
            innerRef=${settingsWrapRef}
            bindings=${bindings}
            listeningFor=${listeningFor}
            onListen=${setListeningFor}
            onResetKeys=${() => setBindings({ ...DEFAULT_KEYS })}
            onResetPositions=${resetPositions}
            onClose=${() => setSettingsOpen(false)}
          />` : null}
        </div>
        <a className="ghost-link subtle" href="./index.html"><${ArrowLeft} size=${16} />Platform</a>
      </div>
    </header>
    <section className="stepband">
      <div className="step-main">
        <div className="step-meta">
          <span className="step-index">STEP <b>${stepLabel}</b> / ${totalLabel}</span>
          ${following ? html`<span className="badge-live"><i />${followMcp ? 'MCP LIVE' : 'LIVE'}</span>` : null}
        </div>
        <h2 className="step-title">${step.title}</h2>
        <p className="step-copy">${step.copy}</p>
      </div>
      <div className="rail">
        ${SCRIPT.map((item, index) => html`<button
          key=${item.id}
          type="button"
          className=${`rail-seg ${index < activeStepIndex ? 'complete' : index === activeStepIndex ? 'active' : 'idle'}`}
          onClick=${() => jumpTo(index)}
          title=${`Step ${index + 1}: ${item.title}`}
          aria-label=${`Step ${index + 1}: ${item.title}`}
        />`)}
      </div>
    </section>
    <section className="system-stage">
      <${ReactFlow}
        nodes=${nodes}
        edges=${edges}
        onNodesChange=${onNodesChange}
        nodeTypes=${nodeTypes}
        fitView=${true}
        fitViewOptions=${{ padding: 0.1 }}
        minZoom=${0.12}
        maxZoom=${1.4}
        nodesDraggable=${true}
        proOptions=${{ hideAttribution: true }}
        onNodeClick=${(_, node) => { if (node.type === 'system') setSelected(node) }}
        onPaneClick=${() => setSelected(null)}
      >
        <${Background} color="rgba(215,209,194,.14)" gap=${24} />
        <${Controls} position="top-right" showInteractive=${false} />
        <${Panel} position="top-left" className="system-panel">
          <${Metric} label="Budget" value=${metrics.budget} />
          <${Metric} label="Winning bid" value=${metrics.bid} />
          <${Metric} label="Escrow" value=${metrics.escrow} />
          <${Metric} label="Review" value=${metrics.review} />
          <${Metric} label="Settlement" value=${metrics.settlement} />
        </${Panel}>
        <${Panel} position="bottom-left" className="state-legend">
          <b data-state="idle">Idle</b>
          <b data-state="active">Active</b>
          <b data-state="complete">Complete</b>
        </${Panel}>
        <${Panel} position="bottom-right" className=${`system-inspector${selectedNode ? '' : ' is-empty'}`}>
          ${selectedNode
            ? html`
              <span>${selectedNode.data.lane}</span>
              <b>${selectedNode.data.title}</b>
              <p>${selectedNode.data.detail}</p>
              <small className="inspector-hint">Click empty canvas to clear</small>`
            : html`
              <span>Inspector</span>
              <p>Select any node to see its role in the pipeline.</p>`}
        </${Panel}>
      </${ReactFlow}>
    </section>
    <aside className="system-side">
      <${NetworkStatus} data=${liveData} enabled=${liveEnabled} error=${liveError} />
      <${RunDemo}
        tab=${runTab}
        onTab=${setRunTab}
        mcp=${{ session: mcpSession, job: jobById(liveData, mcpSession.jobId), busy: mcpBusy, error: mcpError, onStart: startMcp, onRefresh: refreshMcp }}
        live=${{ runner, job: runnerJob, busy: runnerBusy, error: runnerError, onStart: startRunner, onRefresh: refreshRunner }}
      />
      <${ProofPanel} />
    </aside>
  </main>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
