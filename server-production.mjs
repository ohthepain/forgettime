import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import server from './dist/server/server.js'

const app = new Hono()
app.use('/assets/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('*', serveStatic({ root: './dist/client' }))
app.all('*', c => server.fetch(c.req.raw))
const httpServer = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000), hostname: '0.0.0.0' }, info => {
  console.log(`Forgettime listening on port ${info.port}`)
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => httpServer.close(() => process.exit(0)))
