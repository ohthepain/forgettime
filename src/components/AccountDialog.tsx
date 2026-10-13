import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { X } from 'lucide-react'
import { authClient } from '../lib/auth-client'

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<'login' | 'signup' | 'reset' | 'magic'>('login')
  const [config, setConfig] = useState<{ configured: boolean; google: boolean; email: boolean } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [native, setNative] = useState(true)
  const { data: session } = authClient.useSession()
  useEffect(() => {
    setNative(Capacitor.isNativePlatform())
    dialog.current?.showModal()
    void fetch('/api/auth-config').then(r => r.json()).then(setConfig).catch(() => setMessage('Accounts are unavailable. You can still practise.'))
  }, [])
  return <dialog ref={dialog} className="account-dialog" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose() }}>
    <button className="icon-button close-dialog" aria-label="Close account" onClick={onClose}><X size={20} /></button>
    <h2>{session ? 'Your account' : view === 'signup' ? 'Join Forgettime' : view === 'reset' ? 'Reset password' : view === 'magic' ? 'Email a sign-in link' : 'Welcome back'}</h2>
    {session ? <><p className="muted">Signed in as {session.user.email}</p><button className="primary-button" onClick={async () => { await authClient.signOut(); onClose() }}>Sign out</button></> : <>
      <p className="muted">An account is optional. Your microphone stays on your device.</p>
      {config && !config.configured ? <p className="notice">Accounts need database configuration. Practice and microphone analysis are available without signing in.</p> : <form onSubmit={async event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const email = String(form.get('email'))
        const password = String(form.get('password') ?? '')
        setBusy(true); setMessage('')
        try {
          const result = view === 'signup' ? await authClient.signUp.email({ email, password, name: String(form.get('name')), callbackURL: '/' })
            : view === 'reset' ? await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
            : view === 'magic' ? await authClient.signIn.magicLink({ email, callbackURL: '/' })
            : await authClient.signIn.email({ email, password })
          if (result.error) setMessage(result.error.message ?? 'Please try again.')
          else if (view === 'reset' || view === 'magic' || view === 'signup') setMessage(view === 'signup' ? 'Account created. If a verification email arrives, open its link to verify your account.' : 'Check your email for a link, if this address is eligible.')
          else onClose()
        } catch { setMessage('The account service is unavailable. Please try again.') }
        finally { setBusy(false) }
      }}>
        {view === 'signup' && <label>Name<input name="name" autoComplete="name" required /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        {(view === 'login' || view === 'signup') && <label>Password<input name="password" type="password" autoComplete={view === 'signup' ? 'new-password' : 'current-password'} minLength={10} required /></label>}
        <button className="primary-button" disabled={busy || !config}>{busy ? 'Please wait…' : view === 'signup' ? 'Create account' : view === 'reset' || view === 'magic' ? 'Send link' : 'Sign in'}</button>
      </form>}
      {config?.google && !native && <button className="secondary-button" onClick={async () => {
        const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
        if (result.error) setMessage(result.error.message ?? 'Google sign-in is unavailable.')
      }}>Continue with Google</button>}
      {config?.configured && <div className="account-links">
        <button onClick={() => { setView(view === 'signup' ? 'login' : 'signup'); setMessage('') }}>{view === 'signup' ? 'Already have an account? Sign in' : 'Create an account'}</button>
        {config.email && <><button onClick={() => { setView('reset'); setMessage('') }}>Forgot password?</button><button onClick={() => { setView('magic'); setMessage('') }}>Email me a sign-in link</button></>}
      </div>}
    </>}
    {message && <p className="notice" role="status">{message}</p>}
  </dialog>
}
