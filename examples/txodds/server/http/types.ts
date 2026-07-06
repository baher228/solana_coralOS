import type { DemoRunner } from '../types.js'
import type { DevnetEscrowAdapter } from '../domain/index.js'
import type { ArtifactCollector, ReviewCompletion } from '../review/index.js'

export interface HandlerOptions {
  escrowAdapter?: DevnetEscrowAdapter
  reviewer?: ReviewCompletion
  collectArtifacts?: ArtifactCollector
  demoRunner?: DemoRunner
}
