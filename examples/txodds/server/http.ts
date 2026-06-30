import http from 'node:http'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function readJson(req: http.IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'request body must be JSON')
  }
}

export function send(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}
