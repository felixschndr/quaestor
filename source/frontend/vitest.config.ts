import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

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
    setupFiles: ['./src/setupTests.ts'],
    css: false,
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/setupTests.ts',
        'src/routeTree.gen.ts',
        'src/components/ui/**', // shadcn, vendored
        'src/**/*.d.ts',
      ],
      reporter: ['text-summary', 'text', 'html'],
      // Ratchet: raise as coverage grows, never lower.
      thresholds: { lines: 63, statements: 62, branches: 57, functions: 59 },
    },
  },
})
