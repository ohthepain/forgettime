import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { TrainingSetPrototype } from '../components/TrainingSetPrototype'
import { PracticeScreen } from '../components/PracticeScreen'
export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
 const [prototype, setPrototype] = useState(false)
 useEffect(() => { if (import.meta.env.DEV) setPrototype(new URLSearchParams(window.location.search).has('trainingPrototype')) }, [])
 return prototype ? <TrainingSetPrototype /> : <PracticeScreen />
}
