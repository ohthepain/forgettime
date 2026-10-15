/** Real auth integration against a disposable local PostgreSQL 18 container only. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const run = (command: string, args: string[], env = process.env) => execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let container: string | undefined
let pool: Pool | undefined
const originalEnvironment = { ...process.env }
try {
  // Do not load saved app credentials or send real emails from this test process.
  process.env.DOTENV_CONFIG_PATH = '/dev/null'
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = ''
  process.env.BETTER_AUTH_SECRET = ''
  process.env.BETTER_AUTH_URL = 'http://localhost:3030'
  process.env.SES_FROM_EMAIL = ''
  process.env.GOOGLE_CLIENT_ID = ''
  process.env.GOOGLE_CLIENT_SECRET = ''
  process.env.TRUSTED_ORIGINS = ''
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false'
  const { app } = await import('../src/server/hono')
  const request = (path: string, method = 'GET', body?: object, cookie?: string) => app.request(`http://localhost:3030${path}`, {
    method,
    headers: { origin: 'http://localhost:3030', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.equal((await request('/api/healthz')).status, 200)
  assert.deepEqual(await (await request('/api/auth-config')).json(), { configured: false, google: false, email: false })
  assert.equal((await request('/api/auth/sign-in/email', 'POST', { email: 'test@example.invalid', password: 'unused-password' })).status, 503)
  console.log('PASS: health works with accounts disabled; auth returns a controlled unavailable response.')

  const databasePassword = randomBytes(20).toString('hex')
  container = run('docker', ['run', '--rm', '-d', '--tmpfs', '/var/lib/postgresql:rw,size=512m',
    '-e', `POSTGRES_PASSWORD=${databasePassword}`, '-e', 'POSTGRES_DB=forgettime_auth_test',
    '-p', '127.0.0.1::5432', 'postgres:18-alpine'])
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try { run('docker', ['exec', container, 'pg_isready', '-U', 'postgres']); ready = true; break }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)) }
  }
  assert.ok(ready, 'Disposable PostgreSQL must become ready')
  const port = run('docker', ['port', container, '5432/tcp']).split(':').at(-1)
  assert.match(port ?? '', /^\d+$/)
  process.env.DATABASE_URL = `postgresql://postgres:${databasePassword}@127.0.0.1:${port}/forgettime_auth_test`
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex')
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
  if (process.argv.includes('--legacy-schema')) {
    await pool.query(await readFile(new URL('./fixtures/legacy-auth.sql', import.meta.url), 'utf8'))
    console.log('Validating adoption of the previous empty auth schema.')
  }
  run('pnpm', ['db:migrate:deploy'])
  run('pnpm', ['db:migrate:deploy']) // Applying committed migrations again must be harmless.
  assert.deepEqual(await (await request('/api/auth-config')).json(), { configured: true, google: false, email: false })

  const credentials = { name: 'Local validation drummer', email: 'drummer@example.invalid', password: 'Isolated-test-password-92!' }
  const signup = await request('/api/auth/sign-up/email', 'POST', credentials)
  assert.equal(signup.status, 200, `signup: ${await signup.clone().text()}`)
  const signupUser = await signup.json() as { user: { email: string } }
  assert.equal(signupUser.user.email, credentials.email)
  const cookieOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  const signupCookie = cookieOf(signup)
  assert.ok(signupCookie.includes('session_token='), 'Signup issues a session cookie')
  const session = await (await request('/api/auth/get-session', 'GET', undefined, signupCookie)).json() as { user: { email: string } }
  assert.equal(session.user.email, credentials.email)
  const account = await pool.query('SELECT password FROM account WHERE "providerId" = $1', ['credential'])
  assert.equal(account.rows.length, 1)
  assert.ok(account.rows[0].password && account.rows[0].password !== credentials.password, 'Password must be stored as a hash')
  assert.equal((await request('/api/auth/sign-out', 'POST', {}, signupCookie)).status, 200)
  assert.equal(await (await request('/api/auth/get-session', 'GET', undefined, signupCookie)).json(), null)
  console.log('PASS: signup, persisted account/password hash, session cookie, session lookup and logout invalidation.')

  const wrong = await request('/api/auth/sign-in/email', 'POST', { email: credentials.email, password: 'Definitely-the-wrong-password' })
  assert.equal(wrong.status, 401)
  const signin = await request('/api/auth/sign-in/email', 'POST', { email: credentials.email, password: credentials.password })
  assert.equal(signin.status, 200, `signin: ${await signin.clone().text()}`)
  const signinCookie = cookieOf(signin)
  const signedInSession = await request('/api/auth/get-session', 'GET', undefined, signinCookie)
  const sessionText = await signedInSession.text()
  assert.equal(signedInSession.status, 200)
  assert.equal(JSON.parse(sessionText).user.email, credentials.email)
  for (const privateValue of [credentials.password, account.rows[0].password, process.env.BETTER_AUTH_SECRET, databasePassword]) {
    assert.ok(!sessionText.includes(privateValue), 'Public session response must not expose internal credentials')
  }
  assert.equal((await request('/api/auth/sign-out', 'POST', {}, signinCookie)).status, 200)
  assert.equal(await (await request('/api/auth/get-session', 'GET', undefined, signinCookie)).json(), null)
  assert.equal((await request('/api/healthz')).status, 200)
  console.log('PASS: incorrect password rejected, valid signin/session, no internal credentials in session, signout and health.')
} finally {
  await pool?.end()
  // Close the app pool before removing the throwaway database.
  if (container) {
    const { closeDatabase } = await import('../src/server/db')
    try { await closeDatabase() } catch { /* The migration may have failed before initialization. */ }
    run('docker', ['rm', '-f', container])
  }
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key]
  Object.assign(process.env, originalEnvironment)
}
