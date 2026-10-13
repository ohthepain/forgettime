import 'dotenv/config'
import { Hono } from 'hono'
import { authConfiguration, getAuth } from './auth'

export const app = new Hono()
app.get('/api/healthz', c => c.json({ status: 'ok', service: 'forgettime' }))
app.get('/api/auth-config', c => c.json(authConfiguration()))
app.on(['GET', 'POST'], '/api/auth/*', c => {
  if (!authConfiguration().configured) return c.json({ message: 'Accounts are not configured yet. You can still practise without an account.' }, 503)
  return getAuth().handler(c.req.raw)
})
app.onError((error, c) => {
  console.error('[api]', error.name)
  return c.json({ message: 'The account service is unavailable. Please try again later.' }, 503)
})
app.notFound(c => c.json({ message: 'Not found' }, 404))
