import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FlatCompat } = require('@eslint/eslintrc');
const baseDirectory = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory,
});

export default [
  {
    ignores: ['**/.next/**', '**/dist/**', '**/coverage/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];
