import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url))
export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/preview/', import.meta.url))

export interface WorkerConfig {
  agentName: string
  wallet: string
  deliveryRepo: string
  deliveryDelayMs: number
  deliveryPort: number
  deliveryUrl: string
  generatedRoot: string
  publicPreviewBaseUrl: string
  generateDelivery: boolean
  transport: string
  apiBase: string
  apiToken: string
  pollMs: number
  targetJobId: string
  reviewMode: string
  bidPriceSol: string | undefined
  deliveryNotes: string | undefined
}

export function readConfig(): WorkerConfig {
  return {
    agentName: process.env.AGENT_NAME || 'demo-worker',
    wallet: process.env.DEMO_WORKER_WALLET || process.env.WALLET || '',
    deliveryRepo: process.env.DEMO_DELIVERY_REPO || '',
    deliveryDelayMs: Number(process.env.DEMO_DELIVERY_DELAY_MS ?? 1500),
    deliveryPort: Number(process.env.DEMO_DELIVERY_PORT ?? 4177),
    deliveryUrl: process.env.DEMO_DELIVERY_URL || '',
    generatedRoot: process.env.DEMO_DELIVERY_DIR || path.join(tmpdir(), 'solana-coralos-demo-worker'),
    publicPreviewBaseUrl: process.env.DEMO_PUBLIC_PREVIEW_BASE_URL || '',
    generateDelivery: process.env.DEMO_GENERATE_DELIVERY === '1',
    transport: (process.env.AGENT_TRANSPORT || 'api').toLowerCase(),
    apiBase: process.env.AGENT_API_BASE || process.env.PLATFORM_API_URL || 'http://localhost:8801',
    apiToken: process.env.AGENT_API_TOKEN || '',
    pollMs: Number(process.env.DEMO_AGENT_POLL_MS ?? 3000),
    targetJobId: process.env.DEMO_TARGET_JOB_ID || '',
    reviewMode: process.env.DEMO_REVIEW_MODE || '',
    bidPriceSol: process.env.DEMO_BID_PRICE_SOL,
    deliveryNotes: process.env.DEMO_DELIVERY_NOTES,
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function threadKey(threadId: string | undefined, round: number) {
  return `${threadId || 'thread'}:${round}`
}
