import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.WEB_PORT ?? 3020)
const ROOT = fileURLToPath(new URL('../web/', import.meta.url))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`)
    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
    const file = path.resolve(ROOT, `.${requested}`)
    if (!file.startsWith(path.resolve(ROOT))) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await fs.readFile(file)
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, () => {
  console.error(`[freelance-escrow] web on http://localhost:${PORT}`)
})
