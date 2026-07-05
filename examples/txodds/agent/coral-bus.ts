import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

type BusThread = {
  id: string
  name: string
  participants: Set<string>
  createdAt: string
}

type BusMessage = {
  id: number
  threadId: string
  senderName: string
  text: string
  mentions: string[]
  at: string
}

const threads = new Map<string, BusThread>()
const messages: BusMessage[] = []
const deliveredByAgent = new Map<string, Set<number>>()
let nextMessageId = 1

function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

function agentFromHeader(req: http.IncomingMessage): string {
  const header = req.headers['x-coral-agent-name']
  return (Array.isArray(header) ? header[0] : header || '').trim()
}

function callerName(headerAgentName: string, fallback?: string): string {
  const name = headerAgentName || (fallback || '').trim()
  if (!name) throw new Error('X-Coral-Agent-Name header is required')
  return name
}

function waitMs(input: unknown, fallback = 30_000): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, 60_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function messageVisibleTo(agentName: string, message: BusMessage): boolean {
  const thread = threads.get(message.threadId)
  return Boolean(
    thread?.participants.has(agentName) ||
    message.mentions.includes(agentName),
  )
}

function takeMessage(
  agentName: string,
  predicate: (message: BusMessage) => boolean,
): BusMessage | null {
  let delivered = deliveredByAgent.get(agentName)
  if (!delivered) {
    delivered = new Set<number>()
    deliveredByAgent.set(agentName, delivered)
  }

  for (const message of messages) {
    if (delivered.has(message.id)) continue
    if (message.senderName === agentName) continue
    if (!messageVisibleTo(agentName, message)) continue
    if (!predicate(message)) continue
    delivered.add(message.id)
    return message
  }
  return null
}

async function waitForMessage(
  agentName: string,
  maxWaitMs: number,
  predicate: (message: BusMessage) => boolean,
): Promise<BusMessage | null> {
  const deadline = Date.now() + waitMs(maxWaitMs)
  while (Date.now() <= deadline) {
    const message = takeMessage(agentName, predicate)
    if (message) return message
    await sleep(100)
  }
  return null
}

function mentionPayload(message: BusMessage): Record<string, unknown> {
  return {
    threadId: message.threadId,
    senderName: message.senderName,
    messages: [{
      threadId: message.threadId,
      senderName: message.senderName,
      text: message.text,
      mentions: message.mentions,
      at: message.at,
    }],
  }
}

function timeoutResult(): CallToolResult {
  return textResult(JSON.stringify({ status: 'Timeout reached' }))
}

export function resetCoralBusForTest(): void {
  threads.clear()
  messages.length = 0
  deliveredByAgent.clear()
  nextMessageId = 1
}

export function createCoralBusMcpServer(headerAgentName = ''): McpServer {
  const server = new McpServer({
    name: 'txodds-local-coral-bus',
    version: '0.1.0',
  })

  server.registerTool('coral_create_thread', {
    title: 'Create Coral Thread',
    description: 'Create a local Coral-compatible message thread.',
    inputSchema: {
      threadName: z.string().min(1),
      participantNames: z.array(z.string()).default([]),
      callerAgentName: z.string().optional(),
    },
  }, async ({ threadName, participantNames, callerAgentName }) => {
    const senderName = callerName(headerAgentName, callerAgentName)
    const id = `thread_${randomUUID()}`
    const participants = new Set([senderName, ...participantNames.map((name) => name.trim()).filter(Boolean)])
    const thread: BusThread = {
      id,
      name: threadName,
      participants,
      createdAt: new Date().toISOString(),
    }
    threads.set(id, thread)
    const payload = {
      thread: {
        id,
        name: thread.name,
        participantNames: [...participants],
        createdAt: thread.createdAt,
      },
    }
    return textResult(JSON.stringify(payload), payload)
  })

  server.registerTool('coral_send_message', {
    title: 'Send Coral Message',
    description: 'Send a local Coral-compatible thread message.',
    inputSchema: {
      threadId: z.string().min(1),
      content: z.string(),
      mentions: z.array(z.string()).default([]),
      callerAgentName: z.string().optional(),
    },
  }, async ({ threadId, content, mentions, callerAgentName }) => {
    const senderName = callerName(headerAgentName, callerAgentName)
    const thread = threads.get(threadId)
    if (!thread) throw new Error(`Thread not found: ${threadId}`)

    thread.participants.add(senderName)
    for (const mention of mentions) {
      const name = mention.trim()
      if (name) thread.participants.add(name)
    }

    const message: BusMessage = {
      id: nextMessageId++,
      threadId,
      senderName,
      text: content,
      mentions: mentions.map((mention) => mention.trim()).filter(Boolean),
      at: new Date().toISOString(),
    }
    messages.push(message)
    const payload = {
      ok: true,
      message: {
        threadId: message.threadId,
        senderName: message.senderName,
        text: message.text,
        mentions: message.mentions,
        at: message.at,
      },
    }
    return textResult(JSON.stringify(payload), payload)
  })

  server.registerTool('coral_wait_for_mention', {
    title: 'Wait For Coral Mention',
    description: 'Wait for the next local Coral message visible to this agent.',
    inputSchema: {
      maxWaitMs: z.number().optional(),
      currentUnixTime: z.number().optional(),
      callerAgentName: z.string().optional(),
    },
  }, async ({ maxWaitMs, callerAgentName }) => {
    const agentName = callerName(headerAgentName, callerAgentName)
    const message = await waitForMessage(agentName, waitMs(maxWaitMs), () => true)
    if (!message) return timeoutResult()
    const payload = mentionPayload(message)
    return textResult(JSON.stringify(payload), payload)
  })

  server.registerTool('coral_wait_for_agent', {
    title: 'Wait For Coral Agent',
    description: 'Wait for the next local Coral message from a named agent.',
    inputSchema: {
      agentName: z.string().min(1),
      maxWaitMs: z.number().optional(),
      currentUnixTime: z.number().optional(),
      callerAgentName: z.string().optional(),
    },
  }, async ({ agentName, maxWaitMs, callerAgentName }) => {
    const caller = callerName(headerAgentName, callerAgentName)
    const message = await waitForMessage(caller, waitMs(maxWaitMs), (item) => item.senderName === agentName)
    if (!message) return timeoutResult()
    const payload = mentionPayload(message)
    return textResult(JSON.stringify(payload), payload)
  })

  return server
}

export function createCoralBusHandler(): http.RequestListener {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Coral-Agent-Name')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, threads: threads.size, messages: messages.length }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      resetCoralBusForTest()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, threads: 0, messages: 0 }))
      return
    }

    if (url.pathname !== '/mcp' || req.method !== 'POST') {
      res.statusCode = url.pathname === '/mcp' ? 405 : 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: url.pathname === '/mcp' ? 'Method not allowed' : 'Not found' }))
      return
    }

    const server = createCoralBusMcpServer(agentFromHeader(req))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: (error as Error).message || 'Internal server error' },
          id: null,
        }))
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CORAL_BUS_PORT || 8001)
  http.createServer(createCoralBusHandler()).listen(port, '127.0.0.1', () => {
    console.error(`[coral-bus] local Coral-compatible MCP bus listening on http://127.0.0.1:${port}/mcp`)
  })
}
