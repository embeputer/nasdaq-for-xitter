import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { handleApi } from './http.ts'
import { runIngest } from './ingest.ts'
import { startNoise } from './noise.ts'

const root = resolve(process.cwd(), 'dist')
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'

const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

function fileFor(urlPath: string): string | null {
  const pathname = decodeURIComponent((urlPath.split('?')[0] || '/'))
  const rel = pathname.replace(/^\/+/, '')
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) return null
  if (!existsSync(full) || !statSync(full).isFile()) return null
  return full
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url.startsWith('/api/')) {
    void handleApi(req, res).catch((error: unknown) => {
      if (res.writableEnded) return
      res.statusCode = 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }))
    })
    return
  }
  const file = fileFor(url)
  const path = file ?? join(root, 'index.html')
  if (!existsSync(path)) {
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('Build the site first.')
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', types[extname(path)] || 'application/octet-stream')
  res.setHeader('cache-control', file && path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
  createReadStream(path).pipe(res)
})

server.listen(port, host, () => {
  console.log(`Nasdaq for Xitter listening on http://${host}:${port}`)
})

let ticking = false

function tick() {
  if (ticking) return
  ticking = true
  void runIngest()
    .then((summary) => {
      if (summary.filled || summary.refunded || summary.pending || summary.vaulted || summary.tagged) {
        console.log(
          `ingest filled=${summary.filled} refunded=${summary.refunded} pending=${summary.pending} vaulted=${summary.vaulted} tagged=${summary.tagged}`,
        )
      }
    })
    .catch((error: unknown) => {
      console.error('ingest', error instanceof Error ? error.message : 'failed')
    })
    .finally(() => {
      ticking = false
    })
}

setTimeout(tick, 2000)
setInterval(tick, 15_000)
startNoise()
