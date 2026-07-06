import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './app.js'

export * from './app.js'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer()
}
