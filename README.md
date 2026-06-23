# pay — Agent Economy Demo

**A Solana-native multi-agent payment system. Agents request, pay, and settle on-chain automatically — no human in the loop.**

One agent sells data. Another buys it. Payment is a Solana Pay URL, settlement is on-chain in under a second, and confirmation is detected in real time by Helius. No subscriptions, no API keys, no bank accounts.

[Architecture](#architecture) · [Quick Start](#quick-start) · [Monorepo Layout](#monorepo-layout) · [Contributing](#contributing)

---

## What This Is
`   A Tauri desktop application backed by a Rust multi-agent runtime. Two demo agents demonstrate autonomous agent-to-agent payments on Solana devnet:

- **Seller agent** — generates a Solana Pay URL, waits for confirmed payment, then delivers the data response.
- **Buyer agent** — polls the seller's wallet via Helius every 10 seconds; the moment it detects the expected transfer, it closes the loop and triggers data delivery.

The frontend shows both agents live — their state, action history, and payment flow — updating in real time.

## The Payment Flow

```
┌─────────────────────────────────────────────────────────┐
│  SELLER AGENT                        BUYER AGENT         │
│                                                         │
│  solana:7xK...f9                     Watching: 7xK...f9 │
│    ?amount=0.001                     Polling: every 10s  │
│    &label=DataFeed                                       │
│                                                         │
│  12:01:03 url-generated              12:01:10 poll-tick  │
│  12:01:03 waiting-for-payment        12:01:20 poll-tick  │
│                                                         │
│  [payment sent from any wallet]                          │
│                                                         │
│  12:01:38 payment-confirmed          12:01:38 payment-received
│  12:01:38 delivering-data            sig: 3xK...ab      │
│  → {"price": 189.42}                 from: 9mZ...11     │
└─────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  src-ui (React / Vite / Tailwind / @xyflow/react)        │
│  — real-time agent panels, workflow DAG, action feeds    │
└───────────────────┬─────────────────────────────────────┘
                    │ Tauri IPC (invoke)
┌───────────────────▼─────────────────────────────────────┐
│  src-tauri (Rust / Tauri 2)                              │
│  — IPC command handlers, CoralOS HTTP client             │
└───────────────────┬─────────────────────────────────────┘
                    │ Rust crate dependency
┌───────────────────▼─────────────────────────────────────┐
│  agent-core (Rust library)                               │
│  AgentManager · Strategy trait · MessageBus              │
│  SharedState · WorkflowEngine · AgentRole                │
│  solana_pay/ · helius.rs · jito.rs                       │
└───────┬───────────────────────────┬─────────────────────┘
        │                           │
┌───────▼────────┐       ┌──────────▼──────────┐
│  Solana RPC    │       │  Helius REST API     │
│  (devnet)      │       │  (wallet monitoring) │
└────────────────┘       └─────────────────────┘
```

`agent-core` is also exposed as a standalone REST API by `coral-server` (Axum, port 8080), enabling remote access to the same agent runtime without the Tauri layer.

## Coral Server MCP Integration (Real Agent)

In addition to the Rust runtime, `helius-monitor` is fully integrated as a **first-class Coral agent**. Instead of polling an API independently, the agent is orchestrated by the official Java-based Coral Server running in a Docker container.

- **MCP Protocol:** The agent connects to Coral via the Model Context Protocol (MCP) using a streamable-HTTP transport.
- **Docker Runtime:** Coral launches the agent inside its own isolated Docker container and injects environment variables based on the active session's graph.
- **Dynamic Capabilities:** The agent discovers tools dynamically (e.g., `coral_wait_for_mention`, `coral_send_message`) and uses long-polling to wake up only when it is explicitly addressed by another agent in the session.
- **Puppet API:** We use an idle test-harness agent (`user-proxy`) to securely inject mentions into the session to trigger agent workflows.

For a deep dive into the registry setup, session configuration, and exact MCP flow, read the [Deep Architecture Guide](docs/coral_agent_architecture.md).

## Payment Standards

| Standard | Layer | Role in this project |
|----------|-------|---------------------|
| **Solana Pay** | Application | `solana:` URL encoding for seller payment requests |
| **MPP** | Transport | HTTP 402 + `www-authenticate` / `payment-receipt` headers |
| **x402** | Transport | HTTP 402 + `X-PAYMENT` header with facilitator verify/settle |
| **Helius** | Data | Real-time wallet monitoring and transaction parsing on devnet |
| **Jito** | Execution | MEV-protected bundle submission for payment transactions |

## Quick Start

### Four entry points — pick your language

**Web frontend (no Tauri required — fastest start)**
```sh
# Terminal 1: start the backend
cd coral-server && cargo run

# Terminal 2: start the UI
cd agent_demo/src-ui && npm install && npm run dev
# → http://localhost:5173
```

**Tauri desktop app**
```sh
cd agent_demo/src-ui && npm install
cd ../src-tauri && cargo tauri dev
```

**TypeScript agent runtime**
```sh
cd typescript_sdk/agent-core-ts && npm install
# write your strategy, run with ts-node or compile
```

**Rust agent runtime**
```sh
cd agent_demo && cargo build
# impl Strategy for MyStrategy — full Rust
```

**Python / CoralOS agent**
```sh
docker run -p 8001:8001 coralprotocol/coral-server:latest
# write coral_agent.py — pure Python, no Rust needed
```

### Environment setup

```sh
cp .env.example .env
# fill in VITE_HELIUS_API_KEY — get a free key at helius.dev
```

See [docs/provider-keys.md](docs/provider-keys.md) for step-by-step key setup.

### Build

```sh
# Full Rust workspace build (from agent_demo/)
cd agent_demo && cargo build

# Release binary (coral-server)
cd coral-server && cargo build --release
```

## Monorepo Layout

| Directory | Purpose |
|-----------|---------|
| `agent_demo/` | Tauri workspace — Rust backend + React frontend |
| `agent_demo/agent-core/` | Core Rust library: agent lifecycle, messaging, workflows, Solana Pay, Helius |
| `agent_demo/src-tauri/` | Tauri backend: IPC commands, CoralOS HTTP client |
| `agent_demo/src-ui/` | React frontend: Vite + Tailwind + @xyflow/react |
| `coral-server/` | Axum REST API wrapping agent-core (port 8080) |
| `typescript_sdk/agent-core-ts/` | TypeScript agent runtime — identical concepts to agent-core |
| `typescript_sdk/sdk/` | TypeScript HTTP client for coral-server |
| `ref/` | Read-only reference implementations — do not modify |

## Key Technical Constraints

- **Tauri IPC boundary** — all Rust → UI types must derive `Serialize + Deserialize`.
- **Strategy trait** — all `Strategy` implementations must be `Send + Sync`; use `Arc<Mutex<_>>` for interior state.
- **CoralOS base URL** — empty by default; set at runtime via `set_coralos_url` before any CoralOS API calls.
- **Helius** — wallet monitoring and transaction parsing run against Solana devnet via the Helius REST API; configure your API key before running payment strategies.

## coral-server Endpoints

```
GET  /health
GET  /api/v1/agents        — list agents
POST /api/v1/agents        — create agent
GET  /api/v1/workflows     — list workflows
POST /api/v1/workflows     — trigger workflow
POST /api/v1/messages      — publish message to bus
GET  /api/v1/state         — read shared state
PUT  /api/v1/state         — write shared state
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor guide.

```sh
cd agent_demo

cargo build                                              # build workspace
cargo test                                               # all tests
cargo test -p agent-core                                 # library tests only
cargo clippy --workspace --all-targets -- -D warnings   # lint
cargo fmt                                                # format
```

## License

MIT — see [LICENSE](./LICENSE).
