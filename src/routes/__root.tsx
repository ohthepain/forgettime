import { createRootRoute, HeadContent, Outlet, Scripts, retainSearchParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { TrainingShell } from '../components/TrainingShell'
import styles from '../styles.css?url'

function DevFeedback() {
  useEffect(() => { if (import.meta.env.DEV) { void import('../dev/edit-mode'); if (new URLSearchParams(location.search).get('repro') === '1') void import('../dev/repro-steps'); if (new URLSearchParams(location.search).get('tutorial') === 'profile') void import('../tutorials/profile-adoption-guide'); if (new URLSearchParams(location.search).get('tutorial') === 'splice') void import('../tutorials/splice-training-guide') } }, [])
  return null
}

export const Route = createRootRoute({
  search: { middlewares: import.meta.env.DEV ? [retainSearchParams<{ repro?: string }>(['repro'])] : [] },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#151a20' },
      { name: 'description', content: 'Find your pocket. Hear your own time. A timing meter for drummers.' },
      { title: 'Forgettime · Timing practice' },
    ],
    links: [{ rel: 'stylesheet', href: styles }, { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: () => <TrainingShell><Outlet />{import.meta.env.DEV && <DevFeedback />}</TrainingShell>,
  shellComponent: ({ children }) => <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>,
  notFoundComponent: () => <main className="not-found"><h1>That beat is missing.</h1><a href="/">Back to practice</a></main>,
})
