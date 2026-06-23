import type { Strategy, MutableAgentState } from '../strategy.js'
import { untilAborted } from '../strategy.js'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

export interface HeliusMonitorConfig {
  recipient: string
  amountSol: number
  apiKey?: string
  network?: 'devnet' | 'mainnet-beta'
}

export class HeliusMonitorStrategy implements Strategy {
  readonly name = 'helius-monitor'
  private config: HeliusMonitorConfig

  constructor(config: HeliusMonitorConfig) {
    this.config = config
  }

  private rpcUrl(): string {
    if (this.config.apiKey) {
      const net = this.config.network === 'mainnet-beta' ? 'mainnet' : 'devnet'
      return `https://${net}.helius-rpc.com/?api-key=${this.config.apiKey}`
    }
    return 'https://api.devnet.solana.com'
  }

  private wsUrl(): string {
    if (this.config.apiKey) {
      const net = this.config.network === 'mainnet-beta' ? 'mainnet' : 'devnet'
      return `wss://${net}.helius-rpc.com/?api-key=${this.config.apiKey}`
    }
    return 'wss://api.devnet.solana.com'
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const conn = new Connection(this.rpcUrl(), {
      commitment: 'confirmed',
      wsEndpoint: this.wsUrl(),
    })

    const pubkey = new PublicKey(this.config.recipient)
    const expectedLamports = Math.round(this.config.amountSol * LAMPORTS_PER_SOL)

    let lastLamports = 0
    try {
      const info = await conn.getAccountInfo(pubkey)
      lastLamports = info?.lamports ?? 0
    } catch {
      state.recordAction('monitor-error', 'baseline balance fetch failed')
    }

    state.recordAction('monitoring', `watching ${this.config.recipient} for ${this.config.amountSol} SOL`)

    const subId = conn.onAccountChange(pubkey, (accountInfo) => {
      const current = accountInfo.lamports
      const diff = current - lastLamports
      if (diff > 0) {
        const amountSol = diff / LAMPORTS_PER_SOL
        const qualified = diff >= expectedLamports
        state.recordAction(
          qualified ? 'payment-received' : 'partial-payment',
          `received ${amountSol.toFixed(9)} SOL`
        )
      }
      lastLamports = current
    }, 'confirmed')

    await untilAborted(signal)

    conn.removeAccountChangeListener(subId)
  }
}
