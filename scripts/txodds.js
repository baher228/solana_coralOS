#!/usr/bin/env node
// One-command Freelance Escrow Agent: escrow API + static web UI, then open the browser.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const apiUrl = 'http://localhost:8801'
const webUrl = 'http://localhost:3020'
const npmCmd = platform() === 'win32' ? 'npm.cmd' : 'npm'

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`[freelance-escrow] Node ${process.version} detected - this kit needs Node 20+. Install it from nodejs.org, then re-run.`)
  process.exit(1)
}

function portBusy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true)
      else reject(err)
    })
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port)
  })
}

async function waitFor(url, label, timeoutMs = 20_000) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      last = `${res.status} ${res.statusText}`
    } catch (e) {
      last = e.message
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} did not become ready at ${url}: ${last}`)
}

function spawnService(label, args) {
  const child = spawn(npmCmd, args, { cwd: txDir, shell: platform() === 'win32', stdio: 'inherit' })
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[freelance-escrow] ${label} exited (${signal || code})`)
      stop(1)
    }
  })
  return child
}

function openBrowser() {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', webUrl]]
    : platform() === 'darwin' ? ['open', [webUrl]]
    : ['xdg-open', [webUrl]]
  spawn(cmd, args, { shell: platform() === 'win32', stdio: 'ignore' })
}

let stopping = false
let proxy
let web
function stop(code = 0) {
  stopping = true
  proxy?.kill()
  web?.kill()
  process.exit(code)
}

async function main() {
  const busy = (await Promise.all([portBusy(8801), portBusy(3020)]))
    .map((isBusy, i) => isBusy ? [8801, 3020][i] : null)
    .filter(Boolean)
  if (busy.length) throw new Error(`port${busy.length > 1 ? 's' : ''} already in use: ${busy.join(', ')}`)

  if (!existsSync(join(txDir, 'node_modules'))) {
    console.log('[freelance-escrow] installing deps in examples/txodds ...')
    const install = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
      cwd: txDir,
      shell: platform() === 'win32',
      stdio: 'inherit',
    })
    if (install.status !== 0) process.exit(install.status || 1)
  }

  proxy = spawnService('API', ['run', 'proxy'])
  web = spawnService('web', ['run', 'web'])

  await waitFor(`${apiUrl}/api/health`, 'API')
  await waitFor(webUrl, 'web')
  openBrowser()
  console.log(`\n[freelance-escrow] ready: ${webUrl} (API on ${apiUrl}).\n`)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

main().catch((e) => {
  console.error(`[freelance-escrow] ${e.message}`)
  stop(1)
})
