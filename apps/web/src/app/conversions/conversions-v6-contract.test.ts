import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
const createPage = readFileSync(join(import.meta.dirname, 'new', 'page.tsx'), 'utf8');

describe('V6 コンバージョン', () => {
  it('本文の重複見出しを置かず、V6実Nodeと上部操作を使う', () => {
    expect(page).toContain('data-design-node="ZrpKn"');
    expect(page).toContain("'GUxsj'");
    expect(page).toContain('成果地点を作る');
    expect(page).not.toContain("import Header from '@/components/layout/header'");
    expect(createPage).toContain('data-design-node="GtylA"');
  });

  it('成果地点を物理削除せず、計測停止として扱う', () => {
    expect(page).toContain('api.conversions.stopPoint(id)');
    expect(page).toContain('過去の成果と金額は残ります');
    expect(page).toContain('過去実績を保持');
    expect(page).not.toContain('準備中');
    expect(createPage).not.toContain('準備中');
  });
});
