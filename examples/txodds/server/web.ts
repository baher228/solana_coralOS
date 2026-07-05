import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.WEB_PORT || 3020)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web')

const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

async function existingFile(file: string): Promise<string | null> {
  const resolved = path.resolve(file)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  try {
    const info = await stat(resolved)
    if (info.isFile()) return resolved
    if (info.isDirectory()) return existingFile(path.join(resolved, 'index.html'))
  } catch {
    return null
  }
  return null
}

function send(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    pragma: 'no-cache',
    expires: '0',
    'surrogate-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const rawFile = path.resolve(root, requested.replace(/^\/+/, ''))
    const file = await existingFile(rawFile)
      || (!path.extname(rawFile) ? await existingFile(`${rawFile}.html`) : null)
      || (!path.extname(rawFile) ? await existingFile(path.join(root, 'index.html')) : null)
    if (!file || !existsSync(file)) return send(res, 404, 'not found')
    const info = await stat(file)
    res.writeHead(200, {
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'surrogate-control': 'no-store',
      'content-length': info.size,
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    })
    createReadStream(file).pipe(res)
  } catch (e) {
    send(res, 500, (e as Error).message || 'server error')
  }
})

server.listen(PORT, () => {
  console.log(`[txodds-web] http://localhost:${PORT}`)
})
