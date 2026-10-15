import { randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import * as schema from './schema'
import { magicLink } from 'better-auth/plugins'
import { getDatabase } from './db'
import { sendAuthEmail } from './email'

export function authConfiguration() {
  return {
    configured: Boolean(process.env.DATABASE_URL && (process.env.BETTER_AUTH_SECRET || process.env.NODE_ENV !== 'production')),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    email: Boolean(process.env.SES_FROM_EMAIL),
  }
}
function createAuth() {
  const production = process.env.NODE_ENV === 'production'
  if (production && (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET must be a unique secret of at least 32 characters.')
  }
  if (production && !process.env.BETTER_AUTH_URL?.startsWith('https://')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS in production.')
  }
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3030'
  const emailEnabled = Boolean(process.env.SES_FROM_EMAIL)
  if (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true' && !emailEnabled) {
    throw new Error('Email verification requires SES_FROM_EMAIL.')
  }
  return betterAuth({
    appName: 'Forgettime',
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString('hex'),
    database: drizzleAdapter(getDatabase(), { provider: 'pg', schema }),
    trustedOrigins: [baseURL, ...(!production ? ['http://localhost:3030', 'http://127.0.0.1:3030'] : []),
      ...(process.env.TRUSTED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean)],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      ...(emailEnabled ? { sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => sendAuthEmail(user.email, 'Reset your password', url) } : {}),
    },
    ...(emailEnabled ? { emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => sendAuthEmail(user.email, 'Verify your email', url),
    } } : {}),
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    } : {},
    plugins: emailEnabled ? [magicLink({ sendMagicLink: async ({ email, url }) => sendAuthEmail(email, 'Your sign-in link', url) })] : [],
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 60 },
  })
}
let auth: ReturnType<typeof createAuth> | undefined
export const getAuth = () => auth ??= createAuth()
