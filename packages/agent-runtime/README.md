# @pay/agent-runtime

The three pillars every agent in this kit stands on — so you write only *behavior*.

```ts
import { startCoralAgent, generatePaymentUrl, complete, parseBid } from '@pay/agent-runtime'
```

The `coral-agents/` agents depend on it via a local `file:` link. Build its `dist` before dependents:
`npm install && npm run build` (also `npm run typecheck`, `npm test`).

## The pillars

| Pillar | Exports | Module |
|--------|---------|--------|
| **CoralOS** | `startCoralAgent(config, run)`, `CoralMcpAgent`, and the `ctx` verbs (`waitForMention`, `waitForMentionInThread`, `waitForAgent`, `reply`, `send`, `createThread`) | `coral_mcp*.ts` |
| **Solana** | `solanaConnection`/`assertDevnet` (devnet guard), `generatePaymentUrl`/`verifyPayment`/`signTransfer`/`loadKeypairB58` (reference-bound) | `solana.ts`, `solana_pay.ts` |
| **LLM** | `complete()` — SDK-free provider shim (Anthropic default; `LLM_PROVIDER=openai` flips it) + `parseJsonReply` | `llm.ts` |
| **Market** | `formatWant`/`parseBid`/`parseAward`/… + `selectBids`/`pickCheapest` — the marketplace wire protocol (pure) | `market.ts` |

The runtime is coordination + helpers — it never holds a keypair. Settlement is the escrow contract,
called agent-side.

## How to use it

You write the loop; the runtime handles connecting and routing:

```ts
await startCoralAgent({ agentName: 'seller-agent' }, async (ctx) => {
  while (true) {
    const m = await ctx.waitForMention()          // a CoralOS @mention (or null on timeout)
    if (m) await ctx.reply(m, 'BID round=1 price=0.0002 by=seller-cheap')
  }
})
```

`ctx.waitForMentionInThread(threadId)` scopes to one thread; `ctx.waitForAgent(name)` blocks until an
agent comes online before you send it work.

## Extend it

| Want… | Do this |
|---|---|
| new data to sell | edit `deliverService` in `coral-agents/seller-agent` |
| a new seller persona | a `coral-agent.toml` with `PERSONA`/`FLOOR_SOL`/`SERVICES` over the seller image |
| a new agent role | `startCoralAgent({ agentName }, run)` + the market/escrow helpers |

For exact signatures, read the small, commented modules in `src/` — each is one pillar.
