import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AttackAnnotationPrototype } from '../components/AttackAnnotationPrototype'
import { PracticeScreen } from '../components/PracticeScreen'
export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  const [prototype, showPrototype] = useState(false)
  useEffect(() => { if (import.meta.env.DEV) showPrototype(new URLSearchParams(window.location.search).has('variant')) }, [])
  return prototype ? <AttackAnnotationPrototype /> : <PracticeScreen />
}
