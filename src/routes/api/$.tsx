import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/hono'
const serve = ({ request }: { request: Request }) => app.fetch(request)
export const Route = createFileRoute('/api/$')({
  server: { handlers: { GET: serve, POST: serve, PUT: serve, PATCH: serve, DELETE: serve, OPTIONS: serve, HEAD: serve } },
})
