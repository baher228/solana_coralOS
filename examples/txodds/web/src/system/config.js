import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  DatabaseZap,
  GitBranch,
  Scale,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react'
import { API, CORAL_BUS } from '../shared/api.js'

export { API, CORAL_BUS }

export const DEFAULT_JOB_BRIEF = {
  employer: 'Northstar Studio',
  title: 'Build a live agent checkout page',
  budgetSol: '0.003',
  scope: 'Generate and serve a responsive checkout mini-site with pricing copy, mobile proof, and delivery notes.',
  acceptanceCriteria: 'Clickable preview URL, generated checkout hero, pricing proof, mobile responsive layout, and delivery notes for every acceptance item.',
}

export const EMPTY_RUNNER = { running: false, agentName: 'demo-worker-live', logs: [], steps: {} }
export const EMPTY_MCP_SESSION = { active: false, agentName: 'ai-agent-mcp-demo', mcpUrl: `${API}/mcp`, events: [], steps: {} }

export const SCRIPT = [
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
    id: 'artifacts',
    title: 'Artifacts collected',
    copy: 'The platform scans the repo, runs build/test when available, inspects the preview, and captures desktop plus mobile screenshots.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'artifacts ready', settlement: '--' },
    active: ['artifacts'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery'],
  },
  {
    id: 'coral_thread',
    title: 'Coral review thread opens',
    copy: 'The marketplace bridge opens a Coral MCP thread on the local bus and sends an artifact-backed REVIEW_REQUEST to all three panel roles.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'thread opened', settlement: '--' },
    active: ['coral'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery', 'artifacts'],
  },
  {
    id: 'advocates',
    title: 'Advocates argue both sides',
    copy: 'The worker advocate argues for release, the employer advocate probes acceptance gaps, and both opinions are sent to the referee.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: '2 opinions', settlement: '--' },
    active: ['workerAdvocate', 'employerAdvocate', 'coral'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery', 'artifacts'],
  },
  {
    id: 'referee',
    title: 'Referee returns verdict',
    copy: 'The referee weighs both advocate summaries against objective artifacts. Settlement still fails closed when evidence is missing.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'referee approve', settlement: 'pending window' },
    active: ['referee'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery', 'artifacts', 'coral', 'workerAdvocate', 'employerAdvocate'],
  },
  {
    id: 'release',
    title: 'Funds release',
    copy: 'After artifact gates and the Coral referee approval pass, escrow releases funds to the worker agent wallet.',
    metrics: { budget: '0.003 SOL', bid: '0.001 SOL winner', escrow: 'funded', review: 'coral approve', settlement: 'release sig' },
    active: ['settlement'],
    complete: ['employer', 'job', 'feed', 'bid', 'auctioneer', 'escrow', 'delivery', 'artifacts', 'coral', 'workerAdvocate', 'employerAdvocate', 'referee'],
  },
]

export const BASE_NODES = [
  ['employer', 0, 20, 'Marketplace', UserRound, 'Employer', 'Posts scoped work', 'Budget, criteria, milestones'],
  ['job', 260, 20, 'Marketplace', BriefcaseBusiness, 'Open Job', 'Public task listing', 'Available to humans and agents'],
  ['feed', 520, 20, 'Agent Network', DatabaseZap, 'Agent Feed', 'Polling API', 'Tokens identify each agent'],
  ['bid', 780, 20, 'Agent Network', CircleDollarSign, 'Bid Window', 'Wallet-backed bids', 'Cheapest valid bid wins'],
  ['auctioneer', 1040, 20, 'Agent Network', Scale, 'Auctioneer', 'Backend allocator', 'Awards once, blocks duplicates'],
  ['escrow', 1300, 20, 'Escrow', Wallet, 'Devnet Escrow', 'Mandatory funding', 'Buyer deposits final bid amount'],
  ['delivery', 1560, 20, 'Review', Bot, 'Worker Agent', 'Delivery evidence', 'URL, repo, and notes'],
  ['artifacts', 1820, 20, 'Review', ShieldCheck, 'Artifacts', 'Build, tests, screenshots', 'Objective evidence collected first'],
  ['coral', 2080, 20, 'CoralOS', GitBranch, 'Coral MCP Bus', 'Local thread/message bus', 'worker, employer, referee room'],
  ['workerAdvocate', 2340, -90, 'CoralOS', Bot, 'Worker Advocate', 'Release argument', 'Summarizes evidence for the worker'],
  ['employerAdvocate', 2340, 130, 'CoralOS', UserRound, 'Employer Advocate', 'Acceptance argument', 'Flags missing or unclear criteria'],
  ['referee', 2600, 20, 'CoralOS', Scale, 'Referee', 'Authoritative verdict', 'Approves, revises, or disputes'],
  ['settlement', 2860, 20, 'Settlement', CheckCircle2, 'Settlement', 'Release or refund', 'Payout/refund signatures'],
  ['human', 520, 260, 'Marketplace', UserRound, 'Human Worker', 'Manual claim path', 'Still supported for normal jobs'],
]

export const NODE_W = 188
export const NODE_H = 120

export const EDGES = [
  ['e1', 'employer', 'job'],
  ['e2', 'job', 'feed'],
  ['e3', 'feed', 'bid'],
  ['e4', 'bid', 'auctioneer'],
  ['e5', 'auctioneer', 'escrow'],
  ['e6', 'escrow', 'delivery'],
  ['e7', 'delivery', 'artifacts'],
  ['e8', 'artifacts', 'coral'],
  ['e9', 'coral', 'workerAdvocate'],
  ['e10', 'coral', 'employerAdvocate'],
  ['e11', 'workerAdvocate', 'referee'],
  ['e12', 'employerAdvocate', 'referee'],
  ['e13', 'referee', 'settlement'],
  ['e14', 'job', 'human'],
]

export const CAMERA_WINDOWS = {
  post: ['employer', 'job', 'feed'],
  feed: ['job', 'feed', 'bid'],
  bid: ['feed', 'bid', 'auctioneer'],
  award: ['feed', 'bid', 'auctioneer', 'escrow'],
  escrow: ['bid', 'auctioneer', 'escrow', 'delivery'],
  delivery: ['auctioneer', 'escrow', 'delivery', 'artifacts'],
  artifacts: ['escrow', 'delivery', 'artifacts', 'coral'],
  coral_thread: ['delivery', 'artifacts', 'coral', 'workerAdvocate', 'employerAdvocate'],
  advocates: ['artifacts', 'coral', 'workerAdvocate', 'employerAdvocate', 'referee'],
  referee: ['coral', 'workerAdvocate', 'employerAdvocate', 'referee', 'settlement'],
  release: ['workerAdvocate', 'employerAdvocate', 'referee', 'settlement'],
}
