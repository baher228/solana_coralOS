# Skills — Coral Protocol + Solana

Two optional Claude Code skill sets that add commands and knowledge for CoralOS multi-agent
workflows and Solana development. Both install directly — no submodules.

## Coral Protocol skills

Run these inside Claude Code (use the full **HTTPS URL** — the `owner/repo` shorthand clones via SSH
and fails without GitHub SSH keys):

```
/plugin marketplace add https://github.com/Coral-Protocol/coral-skill-set
/plugin install coral-skills@coral-skill-set
/reload-plugins
```

Adds slash commands for CoralOS sessions:

| Command | What it does |
|---------|-------------|
| `/coral-setup` | start, inspect, configure coral-server (provides `CORAL_CONNECTION_URL`) |
| `/coral-session-control` | drive sessions/threads via the same REST + Puppet API the bridge uses |
| `/coral-runtime-reference` | the API/schema reference behind `packages/agent-runtime/src/coral_mcp.ts` |
| `/coralize-your-agent` | wire a new agent into the economy (fork point: `coral-agents/`) |

## Solana dev skill

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

Installed via the [`skills`](https://github.com/vercel-labs/skills) CLI. Adds Solana knowledge +
tooling: `@solana/kit`, Anchor & Pinocchio programs, LiteSVM/Mollusk/Surfpool testing, Codama client
generation, Token-2022, Solana Pay, and a security checklist.

Where it helped in this repo: the **escrow program** (`examples/agent-economy/escrow/`) — written,
security-reviewed against the skill's checklist (`init` not `init_if_needed`, per-order PDA seeds,
`has_one`, `close = buyer`, checked math), built, **deployed to devnet**, and tested. That's the
worked example of what this skill is for.

> The skill is what you'd reach for to take a fork further — accept USDC (Token-2022), add an arbiter
> to the escrow, or generate typed clients with Codama.
