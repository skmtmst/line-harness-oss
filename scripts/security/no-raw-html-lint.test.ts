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
