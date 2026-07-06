import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'web')

export default defineConfig({
  root,
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        system: resolve(root, 'system.html'),
      },
    },
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['server/**/*.test.ts', 'agent/**/*.test.ts'],
  },
})
