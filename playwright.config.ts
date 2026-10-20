import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser/waveform',
  testMatch: '**/*.spec.ts',
  outputDir: 'output/playwright/results',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3037', browserName: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1000, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'pnpm exec vp dev --config tests/browser/waveform/vite.config.ts', url: 'http://127.0.0.1:3037', reuseExistingServer: false },
});
