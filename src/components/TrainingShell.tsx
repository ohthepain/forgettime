import { useEffect } from 'react'
import { useBlocker, useLocation, useNavigate } from '@tanstack/react-router'
import { PracticeScreen } from './PracticeScreen'
import { TrainingPage } from './TrainingPage'
import { trainingNavigation, allowWorkspaceNavigation } from '../lib/training-session'

/** Both workspaces keep their state and workers while routes control visibility. */
export function TrainingShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const path = useLocation({ select: location => location.pathname })
  useEffect(() => { if (import.meta.env.DEV) window.dispatchEvent(new Event('forgettime-route-changed')) }, [path])
  useEffect(() => {
    trainingNavigation.go = path => { void navigate({ to: path }) }
    return () => { trainingNavigation.go = undefined }
  }, [navigate])
  useBlocker({ shouldBlockFn: async ({ current, next }) => current.pathname !== next.pathname ? !(await allowWorkspaceNavigation()) : false, enableBeforeUnload: false })
  return <>
    <div hidden={path !== '/'}><PracticeScreen active={path === '/'} /></div>
    <div hidden={path !== '/training'}><TrainingPage active={path === '/training'} /></div>
    {children}
  </>
}
