// Lazy CoralClient singleton — one instance per page load.
//
// We import the source TypeScript directly so Next.js (Webpack) can bundle it
// without needing to build the SDK separately. The relative path reaches the
// monorepo sibling package from web/.
import { CoralClient } from '../../packages/coral-client/src/client'

let _client: CoralClient | null = null

export function getClient(): CoralClient {
  if (!_client) {
    const baseUrl = process.env.NEXT_PUBLIC_CORAL_SERVER ?? 'http://localhost:8081'
    _client = new CoralClient(baseUrl)
  }
  return _client
}
