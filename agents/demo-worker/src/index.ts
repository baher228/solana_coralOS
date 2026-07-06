import { readConfig } from './config.ts'
import { loadRootEnv } from './env.ts'
import { runApiWorker } from './api-worker.ts'
import { runCoralWorker } from './coral-worker.ts'

await loadRootEnv()

const config = readConfig()

if (config.transport === 'coral') await runCoralWorker(config)
else await runApiWorker(config)
