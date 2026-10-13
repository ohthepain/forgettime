import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../lib/auth-client'
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({ token: typeof search.token === 'string' ? search.token : '' }),
  component: ResetPassword,
})
function ResetPassword() {
  const { token } = Route.useSearch()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return <main className="reset-page"><section className="tempo-card"><h1>Reset your password</h1>{token ? <form onSubmit={async event => {
    event.preventDefault(); setBusy(true)
    const newPassword = String(new FormData(event.currentTarget).get('password'))
    try { const result = await authClient.resetPassword({ token, newPassword }); setMessage(result.error?.message ?? 'Password updated. You can sign in with your new password.') }
    catch { setMessage('Unable to reset your password. Please try again.') }
    finally { setBusy(false) }
  }}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button></form> : <p>This reset link is missing its token. Request a new link from the account menu.</p>}{message && <p role="status">{message}</p>}<Link to="/">Back to practice</Link></section></main>
}
