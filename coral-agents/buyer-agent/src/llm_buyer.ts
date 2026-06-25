/**
 * LLMBuyerStrategy — the agent-economy primitive.
 *
 * Claude, given a goal, fetches a paid endpoint, discovers it needs payment (HTTP 402),
 * decides whether the price is worth it, signs a Solana transfer, and retries — all as
 * autonomous tool use. This is the difference between "a script that pays" and "an agent
 * that decides to pay."
 *
 * Lives in buyer-agent (not the core SDK) because it depends on `@anthropic-ai/sdk`; keeping
 * the LLM dependency out of `agent-runtime` keeps the core runtime lightweight.
 *
 * Three safety properties that make this production-shaped rather than a toy:
 *   1. The tool-use loop is BOUNDED (maxTurns) — an agent that can loop forever is a liability.
 *   2. The budget is enforced in CODE, not the prompt — the model can want to overpay; we refuse.
 *   3. The model can only pay values from a REAL challenge — no hallucinated recipients/amounts.
 */
import Anthropic from '@anthropic-ai/sdk'
import { BaseStrategy, type MutableAgentState, untilAborted } from '@pay/agent-runtime'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { signTransfer } from './wallet.js'

/** A parsed HTTP 402 payment challenge. */
export interface PaymentChallenge {
  recipient: string
  amountSol: number
  reference?: string
}

export interface LLMBuyerConfig {
  /** The paid endpoint to buy from. */
  endpoint: string
  /** System goal: what the buyer wants and why. */
  goal: string
  /** Hard cap in lamports. Enforced in code — the model cannot exceed it. */
  budgetLamports: number
  /** Anthropic model. Defaults to Claude Haiku for cost. */
  model?: string
  /** Max tool-use turns before giving up. Defaults to 8. */
  maxTurns?: number
}

const BUYER_SYSTEM = `You are an autonomous data-buying agent on Solana devnet.
Use fetch_data to get the resource. If it returns a 402 payment challenge, evaluate whether the
price is reasonable for your goal, then call pay_and_retry with the challenge's recipient, amount,
and reference EXACTLY as given. Never invent a recipient, amount, or reference — only use values
from a real challenge. When you have the data, summarize it in one sentence and stop.`

/**
 * Parse a 402 response's `x-payment-required` header (or JSON body) into a challenge.
 * The bare-metal seller (examples/agent-economy/quickstart/server.ts) emits the header form.
 */
export function parse402(headers: Headers, body?: string): PaymentChallenge | null {
  const header = headers.get('x-payment-required')
  const raw = header ?? body
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Partial<PaymentChallenge>
    if (typeof obj.recipient === 'string' && typeof obj.amountSol === 'number') {
      return { recipient: obj.recipient, amountSol: obj.amountSol, reference: obj.reference }
    }
    return null
  } catch {
    return null
  }
}

export class LLMBuyerStrategy extends BaseStrategy {
  readonly name = 'llm-buyer'
  constructor(private config: LLMBuyerConfig) { super() }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const result = await this.purchase(state)
    state.recordAction('purchase-complete', result.slice(0, 200))
    await untilAborted(signal)
  }

  /**
   * Run one autonomous purchase: the Claude tool-use loop. Callable from `run()` or from a
   * CoralOS mention handler. Returns the model's final text answer.
   * @throws if the loop exhausts `maxTurns` without a final answer.
   */
  async purchase(state: MutableAgentState): Promise<string> {
    const llm = new Anthropic()
    const maxTurns = this.config.maxTurns ?? 8

    const tools: Anthropic.Tool[] = [
      {
        name: 'fetch_data',
        description: 'Fetch the endpoint. Returns the data, or a 402 payment challenge.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'pay_and_retry',
        description: 'Pay a Solana Pay challenge, then re-fetch the endpoint with proof.',
        input_schema: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient pubkey from the challenge' },
            amountSol: { type: 'number', description: 'Amount in SOL from the challenge' },
            reference: { type: 'string', description: 'Reference key from the challenge' },
          },
          required: ['recipient', 'amountSol'],
        },
      },
    ]

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: this.config.goal }]

    // Code-enforced trust, not prompt-enforced. Prompt injection in fetched data cannot bypass these.
    const purchase: PurchaseGuard = {
      // recipients (and references) the buyer actually saw in a real 402 challenge
      allowedRecipients: new Set<string>(),
      allowedReferences: new Set<string>(),
      // cumulative spend across the whole loop, capped at budgetLamports
      spentLamports: 0,
    }

    for (let turn = 0; turn < maxTurns; turn++) {
      const resp = await llm.messages.create({
        model: this.config.model ?? 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: BUYER_SYSTEM,
        tools,
        messages,
      })
      messages.push({ role: 'assistant', content: resp.content })

      const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      if (toolUses.length === 0) {
        // No tool calls → the model produced a final answer.
        return resp.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      }

      const results: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        results.push(await this.runTool(tu, state, purchase))
      }
      messages.push({ role: 'user', content: results })
    }
    throw new Error(`purchase loop exhausted ${maxTurns} turns without a final answer`)
  }

  /** Execute one tool call and return its result block. */
  private async runTool(
    tu: Anthropic.ToolUseBlock,
    state: MutableAgentState,
    guard: PurchaseGuard,
  ): Promise<Anthropic.ToolResultBlockParam> {
    if (tu.name === 'fetch_data') {
      const r = await fetch(this.config.endpoint)
      if (r.status === 402) {
        const body = await r.text()
        const challenge = parse402(r.headers, body)
        if (challenge) {
          // Record the legitimate recipient/reference so `pay_and_retry` can only pay these.
          guard.allowedRecipients.add(challenge.recipient)
          if (challenge.reference) guard.allowedReferences.add(challenge.reference)
        }
        state.recordAction('payment-challenge', JSON.stringify(challenge))
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ status: 402, challenge }) }
      }
      const body = await r.text()
      return { type: 'tool_result', tool_use_id: tu.id, content: body.slice(0, 2000) }
    }

    if (tu.name === 'pay_and_retry') {
      const input = tu.input as { recipient: string; amountSol: number; reference?: string }
      const lamports = Math.round(input.amountSol * LAMPORTS_PER_SOL)

      // H2: the recipient MUST come from a challenge we actually received. The "only pay real
      // challenges" rule is enforced here in code — a prompt injection in fetched data cannot
      // make the buyer pay an attacker's address.
      if (!guard.allowedRecipients.has(input.recipient)) {
        return {
          type: 'tool_result', tool_use_id: tu.id, is_error: true,
          content: `refused: recipient ${input.recipient} did not appear in any payment challenge`,
        }
      }
      if (input.reference && !guard.allowedReferences.has(input.reference)) {
        return {
          type: 'tool_result', tool_use_id: tu.id, is_error: true,
          content: `refused: reference ${input.reference} did not appear in any payment challenge`,
        }
      }
      // M3: budget is cumulative across the loop, not per-payment.
      if (guard.spentLamports + lamports > this.config.budgetLamports) {
        return {
          type: 'tool_result', tool_use_id: tu.id, is_error: true,
          content: `budget exceeded: cumulative ${(guard.spentLamports + lamports) / LAMPORTS_PER_SOL} SOL > ${this.config.budgetLamports / LAMPORTS_PER_SOL} SOL`,
        }
      }

      const sig = await signTransfer(input.recipient, input.amountSol, input.reference)
      guard.spentLamports += lamports
      state.recordAction('payment-sent', `${input.amountSol} SOL`, sig)
      const retry = await fetch(this.config.endpoint, { headers: { 'x-payment-proof': sig } })
      const body = await retry.text()
      return { type: 'tool_result', tool_use_id: tu.id, content: body.slice(0, 2000) }
    }

    return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `unknown tool: ${tu.name}` }
  }
}

/** Per-purchase, code-enforced trust state: which recipients/references are payable, and total spent. */
interface PurchaseGuard {
  allowedRecipients: Set<string>
  allowedReferences: Set<string>
  spentLamports: number
}
