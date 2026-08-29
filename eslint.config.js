import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/platform/db/schema.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  // Module boundaries (ADR-0003) are enforced by tests/architecture/boundaries.test.ts,
  // which walks the real import graph. A lint glob cannot express "only through index".
  {
    // Determinism (ADR-0029): domain code takes the clock and id generator by injection.
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'Inject a Clock (ADR-0029: tests must be deterministic).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'crypto', message: 'Inject an IdGenerator (ADR-0029).' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'tools/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
