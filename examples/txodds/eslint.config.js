import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Lints the TypeScript backend + agent code. The no-build web app (JSX) and the
// Rust/Anchor program are out of scope here.
export default tseslint.config(
  {
    ignores: [
      'web/**',
      'escrow/**',
      'node_modules/**',
      'dist/**',
      '.data/**',
      '.data-test/**',
      'output/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts', 'agent/**/*.ts'],
    rules: {
      // TypeScript already resolves globals/types.
      'no-undef': 'off',
      'no-empty': 'off',
      // The Anchor client intentionally uses `any` for the untyped program methods.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
