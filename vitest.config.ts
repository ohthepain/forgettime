import { optimizerBuildDefines } from './scripts/lib/optimizer-build'
import { configDefaults, defineConfig } from 'vite-plus/test/config'
export default defineConfig({
  define: optimizerBuildDefines,
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { exclude: [...configDefaults.exclude, '**/ios/**', '**/android/**', '**/tests/browser/**/*.spec.ts', 'scripts/token-usage.test.mjs'] },
})
