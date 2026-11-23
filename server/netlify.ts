import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { handleApi } from './http.ts'

const FUNCTION_PREFIX = '/.netlify/functions/api'

/** Map a Netlify function URL back to the public /api path. */
export function apiPath(requestUrl: string): string {
  const url = new URL(requestUrl)
  let path = url.pathname
  if (path === FUNCTION_PREFIX || path.startsWith(`${FUNCTION_PREFIX}/`)) {
    path = `/api${path.slice(FUNCTION_PREFIX.length)}`
  }
  return `${path}${url.search}`
}

/**
 * Netlify's web Request, adapted to the Node handler.
 * The body stays buffered until readJson attaches its listeners.
 */
export async function handleRequest(request: Request): Promise<Response> {
  const body = Buffer.from(await request.arrayBuffer())
  const req = Readable.from(body.length ? [body] : []) as IncomingMessage
  req.method = request.method
  req.url = apiPath(request.url)
  req.headers = {}
  request.headers.forEach((value, key) => {
    req.headers[key.toLowerCase()] = value
  })

  const headers = new Headers()
  let payload: string | undefined
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      const key = name.toLowerCase()
      if (key === 'set-cookie') {
        headers.delete('set-cookie')
        const list = Array.isArray(value) ? value : [String(value)]
        for (const cookie of list) headers.append('set-cookie', String(cookie))
        return
      }
      const text = Array.isArray(value) ? value.map(String).join(', ') : String(value)
      headers.set(key, text)
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk
    },
  }

  await handleApi(req, res as unknown as ServerResponse)
  return new Response(payload ?? null, { status: res.statusCode, headers })
}
