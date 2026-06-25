/**
 * Example: TypeScript agent joining a CoralOS MCP session.
 *
 * Run:
 *   CORAL_CONNECTION_URL=http://localhost:8001/mcp \
 *   npx ts-node --esm examples/coral_mcp_example.ts
 */

import { CoralMcpAgent } from '../src/index.js'

const url = process.env.CORAL_CONNECTION_URL
if (!url) {
  console.error('Set CORAL_CONNECTION_URL to the CoralOS MCP endpoint')
  process.exit(1)
}

const agent = new CoralMcpAgent({
  connectionUrl: url,
  agentName: 'ts-helius-monitor',
})

await agent.connect()
console.error('Connected to CoralOS. Waiting for mentions...')

await agent.runLoop(async (mention) => {
  console.error('Mention received:', mention)

  // Your agent logic here — e.g. check Helius for a payment then respond
  const result = {
    type: 'acknowledged',
    from: mention.sender,
    thread: mention.threadId,
    timestamp: new Date().toISOString(),
  }

  return JSON.stringify(result)
})
