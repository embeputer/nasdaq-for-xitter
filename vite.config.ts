import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { handleApi } from './server/http.ts'
import { runIngest } from './server/ingest.ts'

function marketApi(): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/')) {
        next()
        return
      }
      void handleApi(req, res).catch((error: unknown) => {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }))
      })
    })
  }
  return {
    name: 'larp-api',
    configureServer(server) {
      attach(server.middlewares)
      const flag = globalThis as { larpWatch?: boolean }
      if (flag.larpWatch) return
      flag.larpWatch = true
      const tick = () => {
        void runIngest()
          .then((summary) => {
            if (summary.filled || summary.refunded || summary.pending) {
              console.log(`ingest filled=${summary.filled} refunded=${summary.refunded} pending=${summary.pending}`)
            }
          })
          .catch((error: unknown) => {
            console.error('ingest', error instanceof Error ? error.message : 'failed')
          })
      }
      setTimeout(tick, 2000)
      setInterval(tick, 20_000)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [react(), marketApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
