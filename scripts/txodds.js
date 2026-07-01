#!/usr/bin/env node
// One-command Freelance Escrow Agent: local API + static web UI.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const url = 'http://localhost:3020'
const npm = platform() === 'win32' ? 'npm.cmd' : 'npm'

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`[freelance-escrow] Node ${process.version} detected; Node 20+ is required.`)
  process.exit(1)
}

if (!existsSync(join(txDir, 'node_modules'))) {
  console.log('[freelance-escrow] installing deps in examples/txodds ...')
  const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: txDir, shell: platform() === 'win32', stdio: 'inherit' })
  if (install.status !== 0) process.exit(install.status || 1)
}

const api = spawn(npm, ['run', 'proxy'], { cwd: txDir, shell: platform() === 'win32', stdio: 'inherit' })
const web = spawn(npm, ['run', 'web'], { cwd: txDir, shell: platform() === 'win32', stdio: 'inherit' })

setTimeout(() => {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: platform() === 'win32', stdio: 'ignore' })
  console.log(`\n[freelance-escrow] opened ${url} (API on :8801).\n`)
}, 2500)

const stop = () => { api.kill(); web.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
