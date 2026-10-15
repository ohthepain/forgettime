import { configDefaults, defineConfig } from 'vite-plus/test/config'
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { exclude: [...configDefaults.exclude, '**/ios/**', '**/android/**'] },
})
