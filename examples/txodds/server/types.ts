export type Actor = 'employer' | 'worker' | 'agent' | 'system'
export type Status = 'open' | 'funded' | 'submitted' | 'approved' | 'released' | 'revision_requested' | 'disputed' | 'refunded' | 'cancelled'
export type MilestoneStatus = 'pending' | 'complete'
export type SettlementEventType = 'funded' | 'submitted' | 'reviewed' | 'released' | 'disputed' | 'refunded' | 'cancelled'
export type ReviewSource = 'ai' | 'coral-panel' | 'legacy-heuristic' | 'fallback'
export type ReviewRecommendation = 'approve' | 'revision' | 'dispute'
export type ReviewCheckStatus = 'pass' | 'fail' | 'unclear'
export type ArtifactStatus = 'pass' | 'fail' | 'skipped'
export type ArtifactKind = 'screenshot' | 'log' | 'text'

export interface Event { at: string; actor: Actor; type: string; summary: string }
export interface Message { at: string; author: Exclude<Actor, 'system'>; text: string }
export interface Submission { at: string; url: string; repo: string; notes: string }
export interface ReviewCheck { label: string; status: ReviewCheckStatus; reason: string; evidence: string }
export interface ReviewArtifact { id: string; kind: ArtifactKind; label: string; file: string; mime: string }
export interface ArtifactResult { status: ArtifactStatus; summary: string; error?: string; log?: string }
export interface RepoArtifact extends ArtifactResult {
  url?: string
  commit?: string
  packageManager?: string
  scripts?: Record<string, string>
  files?: Array<{ path: string; snippet: string }>
}
export interface BuildArtifact extends ArtifactResult { command?: string; outputDir?: string }
export interface TestArtifact extends ArtifactResult { command?: string }
export interface PreviewArtifact extends ArtifactResult { url?: string; httpStatus?: number; title?: string }
export interface ArtifactRun {
  id: string
  at: string
  repo: RepoArtifact
  build: BuildArtifact
  tests: TestArtifact
  preview: PreviewArtifact
  screenshots: ReviewArtifact[]
  logs: ReviewArtifact[]
}
export interface ReviewPanelOpinion {
  role: 'worker' | 'employer'
  agent?: string
  summary: string
  recommendation?: ReviewRecommendation
  concerns: string[]
  evidence: string[]
}
export interface ReviewPanel {
  threadId?: string
  opinions: ReviewPanelOpinion[]
  verdict?: Record<string, unknown>
  timedOut?: boolean
  artifactSummary: {
    repo: ArtifactStatus
    build: ArtifactStatus
    tests: ArtifactStatus
    preview: ArtifactStatus
    screenshots: number
  }
}
export interface Review {
  at: string
  approved: boolean
  score: number
  summary: string
  missing: string[]
  source: ReviewSource
  recommendation: ReviewRecommendation
  checks: ReviewCheck[]
  risks: string[]
  criteriaResults: ReviewCheck[]
  artifactRun?: ArtifactRun
  confidence: number
  criticalRisks: string[]
  releaseEligible: boolean
  revisionInstructions: string
  autoReleaseAt?: string
  panel?: ReviewPanel
}
export interface Milestone { id: string; title: string; description: string; amountSol: number; status: MilestoneStatus; completedAt?: string }
export interface Dispute {
  at: string
  by: Exclude<Actor, 'system' | 'agent'>
  note: string
  status: 'open' | 'resolved'
  outcome?: 'release' | 'revision' | 'manual'
  reviewedAt?: string
  summary?: string
}
export interface SettlementEvent { at: string; type: SettlementEventType; summary: string }
export interface MarketplaceBid { at: string; round: number; by: string; wallet: string; priceSol: number; note?: string }
export interface MarketplaceState {
  round: number
  status: 'open' | 'awarded' | 'delivered' | 'settled' | 'refunded'
  budgetSol: number
  bids: MarketplaceBid[]
  awardedBid?: MarketplaceBid
  bidWindowEndsAt?: string
  awardError?: string
  threadId?: string
}
export interface ConnectedAgent {
  id: string
  name: string
  wallet?: string
  tokenHash: string
  status: 'active' | 'revoked'
  createdAt: string
  lastSeenAt?: string
}
export type AgentAuth = { kind: 'platform' } | { kind: 'agent'; agent: ConnectedAgent }
export interface DevnetEscrow {
  buyer: string
  seller: string
  reference: string
  escrow: string
  amountSol: number
  deadlineAt: string
  deposit?: string
  release?: string
  refund?: string
}
export interface Settlement {
  mode: 'local-demo' | 'devnet-escrow'
  escrow: string
  release?: string
  refund?: string
  devnet?: DevnetEscrow
  events: SettlementEvent[]
}
export interface Job {
  id: string
  status: Status
  createdAt: string
  title: string
  employer: string
  worker: string
  scope: string
  requirements: string
  acceptanceCriteria: string
  amountSol: number
  milestones: Milestone[]
  reference: string
  messages: Message[]
  submission?: Submission
  review?: Review
  disputes: Dispute[]
  marketplace?: MarketplaceState
  settlement: Settlement
  events: Event[]
}

export interface DemoRunStatus {
  running: boolean
  agentName: string
  pid?: number
  jobId?: string
  previewUrl?: string
  startedAt?: string
  error?: string
  logs: string[]
  steps: {
    agentStarted: boolean
    jobPosted: boolean
    bidPlaced: boolean
    awarded: boolean
    funded: boolean
    buildServed: boolean
    deliverySubmitted: boolean
    reviewCaptured: boolean
  }
}

export interface DemoRunner {
  start(input?: Record<string, unknown>): Promise<DemoRunStatus>
  status(): Promise<DemoRunStatus>
}

export type DeliveryReviewMode = 'artifact-ai' | 'coral-panel'

export interface McpDemoStatus {
  active: boolean
  agentName: string
  mcpUrl: string
  jobId?: string
  previewUrl?: string
  startedAt?: string
  lastSeenAt?: string
  authorizationHeader?: string
  setup?: string
  token?: string
  error?: string
  events: string[]
  steps: {
    registered: boolean
    jobPosted: boolean
    connected: boolean
    bidPlaced: boolean
    awarded: boolean
    funded: boolean
    deliverySubmitted: boolean
    reviewCaptured: boolean
  }
}
