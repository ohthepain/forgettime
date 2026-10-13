import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { exclude: [...configDefaults.exclude, '**/ios/**', '**/android/**'] },
})
