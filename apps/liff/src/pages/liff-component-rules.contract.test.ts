import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? components(path) : entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('B-158：LIFF の操作と入力は共通部品を通す', () => {
  it('素のボタンと入力を描くのは Button と forms/controls だけ', () => {
    const sources = [...components(join(ROOT, 'pages')), ...components(join(ROOT, 'components'))];
    for (const path of sources) {
      if (path.endsWith('/ui/Button.tsx') || path.endsWith('/forms/controls.tsx')) continue;
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/<(?:button|input|textarea|select)(?:\s|>)/);
    }
  });

  it('使われなくなった PageHeader を戻さない', () => {
    expect(existsSync(join(ROOT, 'components', 'ui', 'PageHeader.tsx'))).toBe(false);
  });
});
