#!/usr/bin/env node
// Interactive demo launcher: platform API/web + Coral bus + marketplace review panel.

import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const url = 'http://localhost:3020/system.html'
const npm = platform() === 'win32' ? 'npm.cmd' : 'npm'
const token = process.env.AGENT_API_TOKEN || `demo_${randomBytes(18).toString('base64url')}`

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`[freelance-escrow] Node ${process.version} detected; Node 20+ is required.`)
  process.exit(1)
}

if (!existsSync(join(txDir, 'node_modules'))) {
  console.log('[freelance-escrow] installing deps in examples/txodds ...')
  const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: txDir, shell: platform() === 'win32', stdio: 'inherit' })
  if (install.status !== 0) process.exit(install.status || 1)
}

const baseEnv = {
  ...process.env,
  AGENT_API_TOKEN: token,
  PLATFORM_API_URL: process.env.PLATFORM_API_URL || 'http://localhost:8801',
  CORAL_CONNECTION_URL: process.env.CORAL_CONNECTION_URL || 'http://localhost:8001/mcp',
  MARKETPLACE_WORKER_AGENTS: process.env.MARKETPLACE_WORKER_AGENTS || 'demo-worker',
  AUTO_RELEASE_MS: process.env.AUTO_RELEASE_MS || '0',
}

function run(label, args, extraEnv = {}) {
  const child = spawn(npm, args, {
    cwd: txDir,
    shell: platform() === 'win32',
    stdio: 'inherit',
    env: { ...baseEnv, ...extraEnv },
  })
  child.on('exit', (code) => {
    if (code) console.error(`[freelance-escrow] ${label} exited with code ${code}`)
  })
  return child
}

async function waitFor(label, endpoint) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(endpoint)
      if (res.ok) return
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} did not become ready at ${endpoint}`)
}

const children = []
children.push(run('api', ['run', 'proxy']))
children.push(run('web', ['run', 'web']))
children.push(run('coral bus', ['run', 'coral:bus']))

try {
  await Promise.all([
    waitFor('API', 'http://127.0.0.1:8801/api/health'),
    waitFor('Coral bus', 'http://127.0.0.1:8001/health'),
  ])
} catch (e) {
  console.error(`[freelance-escrow] ${(e).message}`)
  for (const child of children) child.kill()
  process.exit(1)
}

children.push(run('marketplace bridge', ['run', 'agent:marketplace'], { AGENT_NAME: 'marketplace-bridge' }))
children.push(run('review panel agents', ['run', 'agent:review-panel'], { REVIEW_PANEL_ROLE: 'all' }))

setTimeout(() => {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: platform() === 'win32', stdio: 'ignore' })
  console.log(`\n[freelance-escrow] opened ${url}`)
  console.log('[freelance-escrow] demo guide can start a clean run and choose external AI agent or bundled worker.\n')
}, 3500)

const stop = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
