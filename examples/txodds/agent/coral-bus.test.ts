import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CoralMcpAgent } from '../../../packages/agent-runtime/src/coral/mcp.ts'
import { createCoralBusHandler, resetCoralBusForTest } from './coral-bus.ts'

async function withBus<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const server = http.createServer(createCoralBusHandler())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    return await fn(`http://127.0.0.1:${port}/mcp`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('local Coral MCP bus', () => {
  afterEach(() => resetCoralBusForTest())

  it('lets CoralMcpAgent clients create threads and exchange mentions', async () => {
    await withBus(async (connectionUrl) => {
      const worker = new CoralMcpAgent({ connectionUrl, agentName: 'worker-advocate' })
      const referee = new CoralMcpAgent({ connectionUrl, agentName: 'referee' })

      try {
        await worker.connect()
        await referee.connect()

        const threadId = await worker.createThread('review-job-1', ['referee'])
        await worker.sendMessage('REVIEW_OPINION worker says approve', threadId, ['referee'])

        const mention = await referee.waitForMention(1_000)
        expect(mention).toEqual({
          threadId,
          sender: 'worker-advocate',
          text: 'REVIEW_OPINION worker says approve',
        })

        await referee.sendMessage('REVIEW_VERDICT approve', threadId, ['worker-advocate'])
        const reply = await worker.waitForAgent('referee', 1_000)

        expect(reply).toEqual({
          threadId,
          sender: 'referee',
          text: 'REVIEW_VERDICT approve',
        })
      } finally {
        await worker.disconnect().catch(() => {})
        await referee.disconnect().catch(() => {})
      }
    })
  })

  it('clears local threads and messages through the reset endpoint', async () => {
    await withBus(async (connectionUrl) => {
      const baseUrl = connectionUrl.replace(/\/mcp$/, '')
      const worker = new CoralMcpAgent({ connectionUrl, agentName: 'worker-advocate' })

      try {
        await worker.connect()
        const threadId = await worker.createThread('review-job-1', ['referee'])
        await worker.sendMessage('REVIEW_REQUEST stale', threadId, ['referee'])

        const before = await fetch(`${baseUrl}/health`).then((res) => res.json() as Promise<{ threads: number; messages: number }>)
        expect(before.threads).toBe(1)
        expect(before.messages).toBe(1)

        const reset = await fetch(`${baseUrl}/reset`, { method: 'POST' }).then((res) => res.json() as Promise<{ threads: number; messages: number }>)
        expect(reset).toMatchObject({ threads: 0, messages: 0 })

        const after = await fetch(`${baseUrl}/health`).then((res) => res.json() as Promise<{ threads: number; messages: number }>)
        expect(after).toMatchObject({ threads: 0, messages: 0 })
      } finally {
        await worker.disconnect().catch(() => {})
      }
    })
  })
})
