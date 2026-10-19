import { createFileRoute } from '@tanstack/react-router'
// TrainingShell owns this workspace so in-app navigation preserves active searches.
export const Route = createFileRoute('/training')({ component: () => null })
