import type { Strategy, MutableAgentState } from '../strategy.js'
import { untilAborted } from '../strategy.js'
import { PublicKey } from '@solana/web3.js'
import { encodeURL } from '@solana/pay'
import BigNumber from 'bignumber.js'

export interface TransferConfig {
  recipient: string
  amountSol: number
  label?: string
  message?: string
}

export class TransferStrategy implements Strategy {
  readonly name = 'solana-pay-transfer'
  private config: TransferConfig

  constructor(config: TransferConfig) {
    this.config = config
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    try {
      const url = encodeURL({
        recipient: new PublicKey(this.config.recipient),
        amount: new BigNumber(this.config.amountSol),
        label: this.config.label,
        message: this.config.message,
      })
      state.recordAction('url-generated', url.toString())
    } catch (e) {
      state.recordAction('url-error', String(e))
    }
    await untilAborted(signal)
  }
}
