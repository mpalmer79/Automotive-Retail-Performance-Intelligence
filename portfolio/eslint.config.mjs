import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

/**
 * Flat config, composed from `eslint-config-next`'s native flat exports.
 *
 * NOT through `FlatCompat`. The compat bridge is for eslintrc-format configs, and
 * eslint-config-next has shipped flat arrays since v15 - feeding a flat config
 * through the bridge makes `@eslint/eslintrc` try to JSON-stringify a plugin
 * object that references itself, and ESLint dies with "Converting circular
 * structure to JSON" before it lints a single file. Importing the arrays directly
 * is both correct and simpler.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'review-screenshots/**',
      'src/generated/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  prettier,
  {
    rules: {
      // A `console.log` left in a client component ships to every visitor.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Build tooling and tests run in Node and legitimately print progress.
    files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.*'],
    rules: { 'no-console': 'off' },
  },
]

export default config
