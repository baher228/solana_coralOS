/**
 * CoralMcpAgent — full MCP participant in CoralOS sessions.
 *
 * Mirrors exactly what coral_agent.py does in Python:
 *   connect → list_tools → loop(wait_for_mention → handler → send_message)
 *
 * Usage:
 *   const agent = new CoralMcpAgent({ connectionUrl: process.env.CORAL_CONNECTION_URL!, agentName: "my-ts-agent" })
 *   await agent.connect()
 *   await agent.runLoop(async (mention) => {
 *     // do work based on mention
 *     return `response to ${mention.sender}`
 *   })
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

export interface CoralMention {
  threadId?: string
  sender?: string
  text: string
}

export interface CoralMcpConfig {
  connectionUrl: string
  agentName: string
  version?: string
}

export class CoralMcpAgent {
  private client: Client | null = null
  private toolNames: { waitForMention: string; sendMessage: string } | null = null
  private config: CoralMcpConfig

  constructor(config: CoralMcpConfig) {
    this.config = config
  }

  /** Connect to CoralOS and discover tools. Must call before waitForMention/sendMessage. */
  async connect(): Promise<void> {
    this.client = new Client(
      {
        name: this.config.agentName,
        version: this.config.version ?? "1.0.0",
      },
      { capabilities: {} },
    )

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.connectionUrl),
    )

    await this.client.connect(transport)

    const toolsResult = await this.client.listTools()
    const names = toolsResult.tools.map((t) => t.name)
    console.error(`[coral-mcp] tools: ${names.join(", ")}`)

    this.toolNames = {
      waitForMention:
        names.find((n) => n.includes("wait_for_mention")) ??
        "coral_wait_for_mentions",
      sendMessage:
        names.find((n) => n.endsWith("send_message")) ?? "coral_send_message",
    }

    console.error(
      `[coral-mcp] using: wait=${this.toolNames.waitForMention} send=${this.toolNames.sendMessage}`,
    )
  }

  /**
   * Block until a mention arrives. Returns null on timeout (empty/null response).
   * maxWaitMs default 30 000 matches the Python agent.
   */
  async waitForMention(maxWaitMs = 30_000): Promise<CoralMention | null> {
    if (!this.client || !this.toolNames) throw new Error("Not connected — call connect() first")

    const result = await this.client.callTool({
      name: this.toolNames.waitForMention,
      arguments: { maxWaitMs },
    })

    // Extract text from content array
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join(" ")
      .trim()

    if (!text || text === "null" || text === "{}" || text === "[]") {
      return null
    }

    return parseMention(text)
  }

  /** Send a message into a CoralOS thread. */
  async sendMessage(
    content: string,
    threadId?: string,
    mentions?: string[],
  ): Promise<void> {
    if (!this.client || !this.toolNames) throw new Error("Not connected")

    const args: Record<string, unknown> = { content }
    if (threadId) args.threadId = threadId
    if (mentions?.length) args.mentions = mentions

    await this.client.callTool({
      name: this.toolNames.sendMessage,
      arguments: args,
    })
  }

  /**
   * Run the standard CoralOS loop:
   *   wait_for_mention → handler(mention) → send_message(response)
   *
   * Runs until signal is aborted or an unrecoverable error occurs.
   */
  async runLoop(
    handler: (mention: CoralMention) => Promise<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    while (!signal?.aborted) {
      try {
        const mention = await this.waitForMention(30_000)

        if (!mention) {
          // Timeout — CoralOS returned empty, keep waiting
          continue
        }

        console.error(
          `[coral-mcp] mention from ${mention.sender ?? "unknown"} thread=${mention.threadId}`,
        )

        const response = await handler(mention)

        await this.sendMessage(
          response,
          mention.threadId,
          mention.sender ? [mention.sender] : undefined,
        )

        console.error(`[coral-mcp] responded: ${response.slice(0, 120)}`)
      } catch (e) {
        if (signal?.aborted) break
        console.error(`[coral-mcp] loop error: ${e} — retrying in 2s`)
        await new Promise((r) => setTimeout(r, 2_000))
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.close()
    this.client = null
    this.toolNames = null
  }
}

/**
 * Parse the JSON blob returned by coral_wait_for_mentions.
 * Handles all known CoralOS message shapes, mirroring _parse_mention in Python.
 */
function parseMention(text: string): CoralMention {
  let threadId: string | undefined
  let sender: string | undefined

  try {
    const data: Record<string, unknown> = JSON.parse(text)

    threadId =
      (data.threadId as string) ?? (data.thread_id as string) ?? undefined
    sender =
      (data.senderName as string) ??
      (data.sender as string) ??
      (data.senderId as string) ??
      (data.from as string) ??
      undefined

    // Nested messages list (current Coral server format)
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      const m0 = data.messages[0] as Record<string, unknown>
      threadId =
        threadId ??
        (m0.threadId as string) ??
        (m0.thread_id as string) ??
        undefined
      sender =
        sender ??
        (m0.senderName as string) ??
        (m0.sender as string) ??
        (m0.senderId as string) ??
        undefined
    }

    // Single message under "message" key
    if (data.message && typeof data.message === "object") {
      const m = data.message as Record<string, unknown>
      threadId =
        threadId ??
        (m.threadId as string) ??
        (m.thread_id as string) ??
        undefined
      sender =
        sender ??
        (m.senderName as string) ??
        (m.sender as string) ??
        (m.senderId as string) ??
        undefined
    }
  } catch {
    // text is not JSON — use raw text
  }

  return { threadId, sender, text }
}
