import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import styles from '../styles.css?url'
export const Route = createRootRoute({
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
  component: () => <><Outlet /></>,
  shellComponent: ({ children }) => <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>,
  notFoundComponent: () => <main className="not-found"><h1>That beat is missing.</h1><a href="/">Back to practice</a></main>,
})
