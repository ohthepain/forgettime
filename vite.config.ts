import { optimizerBuildDefines } from './scripts/lib/optimizer-build'
import { defineConfig } from 'vite-plus'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  define: optimizerBuildDefines,
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), react()],
})
