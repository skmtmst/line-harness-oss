import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FlatCompat } = require('@eslint/eslintrc');
const baseDirectory = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory,
});

// 閉じる・外すの「×」は文字で描かず、共通の CloseButton（SVG の印）を使う。
const CLOSE_GLYPH = {
  selector: "JSXElement[openingElement.name.name=/^(button|Button)$/] > JSXText[value=/^\\s*[×✕✖]\\s*$/]",
  message: '閉じる・外すの「×」は文字ではなく CloseButton（components/shared/close-button）を使ってください。',
};
// 動きを減らす設定でも流れてしまうので、なめらかなスクロールは scrollMotion() を通す（試験の期待値は除く）。
const SMOOTH_SCROLL = {
  selector: "Property[key.name='behavior'][value.value='smooth']",
  message: "behavior: 'smooth' ではなく scrollMotion()（components/shared/overlay-utils）を使ってください。",
};

export default [
  {
    ignores: ['**/.next/**', '**/dist/**', '**/coverage/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Keep next.rootDir unset while braces has no patched release. The Next
    // plugin then uses context.cwd directly instead of parsing a glob pattern.
    // 画像の alt は必須（意味のある画像は中身、飾りは alt=""）。警告どまりだと CI が通すので落とす。
    // HTML の文字列をそのまま差し込まない（中身が内部の定数でも、要素として描く）。
    rules: {
      'jsx-a11y/alt-text': 'error',
      'react/no-danger': 'error',
      'no-restricted-syntax': ['error', CLOSE_GLYPH],
    },
  },
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': ['error', CLOSE_GLYPH, SMOOTH_SCROLL],
    },
  },
];
