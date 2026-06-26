import type { RawMessage } from './foldRounds.js'

/**
 * Extract thread messages from a CoralOS session's *extended state*.
 *
 * Shape (verified against real devnet output, see tests/coral-session.json):
 *   { threads: [ { messages: [ { senderName, text, mentionNames, … } ] } ], … }
 *
 * Kept defensive about alternative key names so a coral-server version bump degrades gracefully.
 */
export function collectMessages(state: unknown): RawMessage[] {
  const out: RawMessage[] = []
  const root = state as Record<string, unknown>
  const threads = (root?.threads ?? (root?.session as Record<string, unknown>)?.threads) as
    | Array<Record<string, unknown>>
    | undefined
  for (const thread of threads ?? []) {
    for (const m of (thread.messages as Array<Record<string, unknown>>) ?? []) {
      const sender = (m.senderName ?? m.sender ?? m.senderId ?? 'unknown') as string
      const text = (m.text ?? m.content ?? '') as string
      if (text) out.push({ sender, text })
    }
  }
  return out
}
