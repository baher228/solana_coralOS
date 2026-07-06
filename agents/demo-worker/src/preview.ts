import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FIXTURE_ROOT, type WorkerConfig } from './config.ts'
import { generatedDeliveryHtml, type DemoJob } from './logic.ts'

async function serveDirectory(rootDir: string, port: number): Promise<string> {
  const root = path.resolve(rootDir)
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
      const file = path.resolve(root, rel)
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      const stat = await fs.stat(file)
      const chosen = stat.isDirectory() ? path.join(file, 'index.html') : file
      res.setHeader('Content-Type', chosen.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8')
      res.end(await fs.readFile(chosen))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return `http://127.0.0.1:${actualPort}/`
}

function safePath(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'delivery'
}

async function generatedPreviewPath(job: DemoJob, config: WorkerConfig) {
  const rel = safePath(job.id)
  const dir = path.join(config.generatedRoot, rel)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'index.html'), generatedDeliveryHtml(job, config.agentName))
  return rel
}

export function createPreviewResolver(config: WorkerConfig) {
  let fixtureUrl: string | null = config.deliveryUrl || null

  return async function previewUrl(job: DemoJob) {
    if (config.deliveryUrl) return config.deliveryUrl
    if (config.generateDelivery) {
      const rel = await generatedPreviewPath(job, config)
      if (config.publicPreviewBaseUrl) {
        const url = new URL(`${rel}/`, `${config.publicPreviewBaseUrl.replace(/\/+$/, '')}/`).toString()
        console.error(`[${config.agentName}] serving generated delivery at ${url}`)
        return url
      }
      fixtureUrl ||= await serveDirectory(config.generatedRoot, config.deliveryPort)
      const url = new URL(`${rel}/`, fixtureUrl).toString()
      console.error(`[${config.agentName}] serving generated delivery at ${url}`)
      return url
    }
    fixtureUrl ||= await serveDirectory(FIXTURE_ROOT, config.deliveryPort)
    return fixtureUrl
  }
}
