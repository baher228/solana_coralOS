import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'web')
const pkgRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(pkgRoot, 'node_modules/react'),
      'react-dom': resolve(pkgRoot, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(pkgRoot, 'node_modules/react/jsx-runtime.js'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client', '@xyflow/react'],
  },
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
