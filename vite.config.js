import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { runSafeCommand } from './tools/safe-command.mjs'

function commandBridge() {
  const attach = (server) => {
    server.middlewares.use('/__verbaide/run-command', (req, res) => {
      if (req.method !== 'POST' || !String(req.headers['content-type'] || '').includes('application/json')) {
        res.statusCode = 405
        res.end('Method not allowed')
        return
      }
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 32768) req.destroy()
      })
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const body = JSON.parse(raw || '{}')
          const root = process.cwd()
          if (String(body.projectName || '').toLowerCase() !== path.basename(root).toLowerCase()) {
            throw new Error(`Командный мост открыт для проекта «${path.basename(root)}», а выбран «${body.projectName || 'без имени'}»`)
          }
          const result = await runSafeCommand(body.command, root)
          res.statusCode = 200
          res.end(JSON.stringify({ ok: result.code === 0, ...result }))
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
        }
      })
    })
  }
  return { name: 'verbaide-command-bridge', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig({
  // Относительные пути работают и на GitHub Pages в подпапке репозитория,
  // и на собственном домене без отдельной пересборки.
  base: './',
  plugins: [react(), commandBridge()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
