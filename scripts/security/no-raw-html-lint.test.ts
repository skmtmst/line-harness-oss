import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

describe('HTML の文字列を画面へ差し込まない', () => {
  const lint = (code: string) => new ESLint({ overrideConfigFile: resolve('eslint.config.mjs') })
    .lintText(code, { filePath: resolve('apps/web/src/components/shared/raw-html-fixture.tsx') })
    .then(([result]) => result.messages.filter((message) => message.ruleId === 'react/no-danger'));

  it('dangerouslySetInnerHTML を書くと lint が落ちる', async () => {
    const messages = await lint('export const Mark = () => <svg dangerouslySetInnerHTML={{ __html: "<path/>" }} />\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
  });

  it('要素として描けば通る', async () => {
    expect(await lint('export const Mark = () => <svg><path d="M0 0h1" /></svg>\n')).toEqual([]);
  });
});

describe('閉じるの「×」を文字で描かない', () => {
  const lint = (code: string) => new ESLint({ overrideConfigFile: resolve('eslint.config.mjs') })
    .lintText(code, { filePath: resolve('apps/web/src/components/shared/close-glyph-fixture.tsx') })
    .then(([result]) => result.messages.filter((message) => message.ruleId === 'no-restricted-syntax'));

  it('ボタンの中身が「×」「✕」だけなら lint が落ちる', async () => {
    expect(await lint('export const A = () => <button aria-label="閉じる">×</button>\n')).toHaveLength(1);
    expect(await lint('export const B = () => <button aria-label="閉じる">\n  ✕\n</button>\n')).toHaveLength(1);
    expect(await lint('export const E = () => <Button aria-label="削除">×</Button>\n')).toHaveLength(1);
  });

  it('寸法の「×」や SVG の印は通る', async () => {
    expect(await lint('export const C = () => <span>1200×810</span>\n')).toEqual([]);
    expect(await lint('export const D = () => <button aria-label="閉じる"><svg /></button>\n')).toEqual([]);
  });
});

describe('なめらかなスクロールを直書きしない', () => {
  const lint = (code: string) => new ESLint({ overrideConfigFile: resolve('eslint.config.mjs') })
    .lintText(code, { filePath: resolve('apps/web/src/components/shared/scroll-fixture.tsx') })
    .then(([result]) => result.messages.filter((message) => message.ruleId === 'no-restricted-syntax'));

  it("behavior: 'smooth' を書くと lint が落ち、scrollMotion() なら通る", async () => {
    expect(await lint("export const go = (el: HTMLElement) => el.scrollIntoView({ behavior: 'smooth' })\n")).toHaveLength(1);
    expect(await lint("declare const scrollMotion: () => ScrollBehavior\nexport const go = (el: HTMLElement) => el.scrollIntoView({ behavior: scrollMotion() })\n")).toEqual([]);
  });
});
