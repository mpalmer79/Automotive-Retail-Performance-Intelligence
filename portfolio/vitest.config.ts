import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Unit and component test configuration.
 *
 * `jsdom` rather than a browser: these tests cover manifest validation, status
 * derivation, gate logic, filtering, search and component markup. Anything that
 * genuinely needs a layout engine - focus order, reduced motion, horizontal
 * overflow, contrast - is tested in Playwright against a real browser instead,
 * because jsdom has no layout and would report those as passing without checking
 * them.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    clearMocks: true,
  },
})
