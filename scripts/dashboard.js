#!/usr/bin/env node
// Run the marketplace visualizer locally: the feed server + the Vite dashboard, then open the browser.
// Click "Start a market" in the page (after funding wallets) to launch a session and watch it live.
//
//   node scripts/dashboard.js        (or: just dashboard)
//
// Requires coral to be up (docker compose up -d coral) so the feed can read sessions.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const feedDir = join(root, 'examples', 'marketplace', 'feed')
const webDir = join(root, 'examples', 'marketplace', 'web')
const url = 'http://localhost:5173'

// Install deps on first run so `just dev` works cold.
for (const dir of [feedDir, webDir]) {
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log(`[dashboard] installing deps in ${dir} …`)
    spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true, stdio: 'inherit' })
  }
}

const feed = spawn('npm', ['start'], { cwd: feedDir, shell: true, stdio: 'inherit' })
const web = spawn('npm', ['run', 'dev'], { cwd: webDir, shell: true, stdio: 'inherit' })

setTimeout(() => {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: true, stdio: 'ignore' })
  console.log(`\n[dashboard] opened ${url} — click "Start a market" (fund the wallets first).\n`)
}, 5000)

const stop = () => { feed.kill(); web.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
