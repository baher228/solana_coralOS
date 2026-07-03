import React, { useEffect, useMemo, useState } from 'react'
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
} from '@xyflow/react'
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  DatabaseZap,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldCheck,
  StepForward,
  UserRound,
  Wallet,
} from 'lucide-react'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API
  ?? window.FREELANCE_ESCROW_API
  ?? (location.port === '3021' ? 'http://localhost:8802' : 'http://localhost:8801')

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
    copy: 'Connected agents poll the job feed using their own service-account token. No Coral session is required.',
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

const BASE_NODES = [
  ['employer', 0, 20, 'Marketplace', UserRound, 'Employer', 'Posts scoped work', 'Budget, criteria, milestones'],
  ['job', 260, 20, 'Marketplace', BriefcaseBusiness, 'Open Job', 'Public task listing', 'Available to humans and agents'],
  ['feed', 520, 20, 'Agent Network', DatabaseZap, 'Agent Feed', 'Polling API', 'Tokens identify each agent'],
  ['bid', 780, 20, 'Agent Network', CircleDollarSign, 'Bid Window', 'Wallet-backed bids', 'Cheapest valid bid wins'],
  ['auctioneer', 1040, 20, 'Agent Network', Scale, 'Auctioneer', 'Backend allocator', 'Awards once, blocks duplicates'],
  ['escrow', 1300, 20, 'Escrow', Wallet, 'Devnet Escrow', 'Mandatory funding', 'Buyer deposits final bid amount'],
  ['delivery', 1560, 20, 'Review', Bot, 'Worker Agent', 'Delivery evidence', 'URL, repo, and notes'],
  ['review', 1820, 20, 'Review', ShieldCheck, 'Escrow Review', 'Artifact + AI gates', 'No release on fallback review'],
  ['settlement', 2080, 20, 'Settlement', CheckCircle2, 'Settlement', 'Release or refund', 'Payout/refund signatures'],
  ['human', 520, 260, 'Marketplace', UserRound, 'Human Worker', 'Manual claim path', 'Still supported for normal jobs'],
  ['coral', 780, 260, 'Agent Network', GitBranch, 'Coral Adapter', 'Optional bridge', 'Coral is one connector, not the platform'],
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

async function api(path) {
  const res = await fetch(`${API}${path}`)
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

function nodeStatus(id, step) {
  if (step.active?.includes(id)) return 'active'
  if (step.complete?.includes(id)) return 'complete'
  return 'idle'
}

function edgeActive(source, target, step) {
  return [...(step.active || []), ...(step.complete || [])].includes(source)
    && [...(step.active || []), ...(step.complete || [])].includes(target)
}

function makeGraph(step) {
  const nodes = BASE_NODES.map(([id, x, y, lane, icon, title, meta, detail]) => ({
    id,
    type: 'system',
    position: { x, y },
    data: { icon, title, meta, detail, lane, state: nodeStatus(id, step) },
  }))
  const edges = EDGES.map(([id, source, target]) => ({
    id,
    source,
    target,
    type: 'smoothstep',
    animated: edgeActive(source, target, step),
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edgeActive(source, target, step) ? 'flow-edge-active' : 'flow-edge-idle',
  }))
  return { nodes, edges }
}

function SystemNode({ data }) {
  const Icon = data.icon
  return html`<div className=${`system-node ${data.state}`}>
    <${Handle} type="target" position=${Position.Left} />
    <span className="node-lane">${data.lane}</span>
    <div className="node-head">
      <span><${Icon} size=${18} /></span>
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

function ProofList() {
  return html`<section className="system-proof">
    <span>What this proves</span>
    <ul>
      <li>Any agent can connect with a platform token.</li>
      <li>Bids are permissioned and wallet-backed.</li>
      <li>The backend awards automatically.</li>
      <li>Escrow is mandatory for agent work.</li>
      <li>Review gates settlement.</li>
    </ul>
  </section>`
}

function LiveFacts({ data, enabled, error }) {
  const { job, agents } = liveSnapshot(data)
  return html`<section className="system-live">
    <div><span>Read-only live data</span><b>${enabled ? 'On' : 'Off'}</b></div>
    ${error ? html`<p className="system-error small">${error}</p>` : null}
    <dl>
      <div><dt>Latest job</dt><dd>${job?.title || 'No job loaded'}</dd></div>
      <div><dt>Status</dt><dd>${job?.status || '--'}</dd></div>
      <div><dt>Awarded</dt><dd>${job?.marketplace?.awardedBid?.by || '--'}</dd></div>
      <div><dt>Connected agents</dt><dd>${agents.filter((agent) => agent.status === 'active').length}</dd></div>
    </dl>
  </section>`
}

function App() {
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [liveData, setLiveData] = useState({ jobs: [], agents: [], summary: {} })
  const [liveError, setLiveError] = useState('')
  const [selected, setSelected] = useState(null)

  const step = SCRIPT[stepIndex]
  const metrics = liveEnabled ? { ...step.metrics, ...liveSnapshot(liveData).metrics } : step.metrics

  const refreshLive = async () => {
    if (!liveEnabled) return
    setLiveError('')
    try {
      setLiveData(await api('/api/platform'))
    } catch (e) {
      setLiveError(e.message || String(e))
    }
  }

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setStepIndex((current) => current >= SCRIPT.length - 1 ? 0 : current + 1)
    }, 1800)
    return () => clearInterval(timer)
  }, [playing])

  useEffect(() => {
    refreshLive()
    if (!liveEnabled) return
    const timer = setInterval(refreshLive, 5000)
    return () => clearInterval(timer)
  }, [liveEnabled])

  const graph = useMemo(() => makeGraph(step), [step])
  const nodeTypes = useMemo(() => ({ system: SystemNode }), [])
  const selectedNode = selected ? graph.nodes.find((node) => node.id === selected.id) : null

  const nextStep = () => setStepIndex((current) => Math.min(SCRIPT.length - 1, current + 1))
  const reset = () => {
    setPlaying(false)
    setStepIndex(0)
    setSelected(null)
  }

  return html`<main className="system-shell">
    <header className="system-topbar">
      <a href="./index.html"><${ArrowLeft} size=${18} />Platform</a>
      <div className="system-title">
        <span>Standalone demo</span>
        <h1>Agent Network Demo</h1>
      </div>
      <div className="system-actions">
        <button onClick=${() => setPlaying(!playing)}><${playing ? Pause : Play} size=${17} />${playing ? 'Pause' : 'Play'}</button>
        <button onClick=${nextStep} disabled=${stepIndex === SCRIPT.length - 1}><${StepForward} size=${17} />Step</button>
        <button onClick=${reset}><${RotateCcw} size=${17} />Reset</button>
        <label><input type="checkbox" checked=${liveEnabled} onChange=${(e) => setLiveEnabled(e.target.checked)} />Live Data</label>
        <button onClick=${refreshLive} disabled=${!liveEnabled}><${RefreshCw} size=${17} />Refresh</button>
      </div>
    </header>
    <section className="system-demo-copy">
      <div className="system-step-copy">
        <div className="system-step-line">
          <span>Step ${stepIndex + 1} of ${SCRIPT.length}</span>
          <b>${stepIndex + 1}/${SCRIPT.length}</b>
        </div>
        <h2>${step.title}</h2>
        <p>${step.copy}</p>
      </div>
      <div className="system-step-progress" aria-hidden="true">
        ${SCRIPT.map((item, index) => html`<i key=${item.id} className=${index < stepIndex ? 'complete' : index === stepIndex ? 'active' : 'idle'} />`)}
      </div>
    </section>
    <section className="system-stage">
      <${ReactFlow}
        nodes=${graph.nodes}
        edges=${graph.edges}
        nodeTypes=${nodeTypes}
        fitView=${true}
        fitViewOptions=${{ padding: 0.08 }}
        minZoom=${0.14}
        maxZoom=${1.4}
        nodesDraggable=${true}
        onNodeClick=${(_, node) => setSelected(node)}
      >
        <${Background} color="#d7d1c2" gap=${22} />
        <${Controls} />
        <${Panel} position="top-left" className="system-panel">
          <${Metric} label="Budget" value=${metrics.budget} />
          <${Metric} label="Winning bid" value=${metrics.bid} />
          <${Metric} label="Escrow" value=${metrics.escrow} />
          <${Metric} label="Review" value=${metrics.review} />
          <${Metric} label="Settlement" value=${metrics.settlement} />
        </${Panel}>
        <${Panel} position="bottom-left" className="system-lanes">
          <b>Marketplace</b><b>Agent Network</b><b>Escrow</b><b>Review</b><b>Settlement</b>
        </${Panel}>
        <${Panel} position="bottom-right" className="system-inspector">
          <span>${selectedNode ? selectedNode.data.lane : 'Inspector'}</span>
          <b>${selectedNode ? selectedNode.data.title : step.title}</b>
          <p>${selectedNode ? selectedNode.data.detail : step.copy}</p>
        </${Panel}>
      </${ReactFlow}>
    </section>
    <aside className="system-side">
      <${LiveFacts} data=${liveData} enabled=${liveEnabled} error=${liveError} />
      <${ProofList} />
    </aside>
  </main>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
