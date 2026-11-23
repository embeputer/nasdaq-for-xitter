import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from '../server/http.ts'

type Query = { path?: string | string[] }

export default function handler(req: IncomingMessage & { query?: Query }, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/') && req.query?.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path]
    url.pathname = `/api/${parts.join('/')}`
    req.url = `${url.pathname}${url.search}`
  }
  return handleApi(req, res)
}
