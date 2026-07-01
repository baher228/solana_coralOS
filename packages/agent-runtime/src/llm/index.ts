// LLM pillar — provider-agnostic completion (Anthropic default, OpenAI via LLM_PROVIDER=openai).

export { complete, pickProvider, parseJsonReply } from './complete.js'
export type { LlmProvider, CompleteOpts } from './complete.js'
