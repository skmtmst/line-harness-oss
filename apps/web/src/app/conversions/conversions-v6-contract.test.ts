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
    expect(page).toContain('api.conversions.stopPoint(stopTarget.id)');
    expect(page).toContain('data-design-node="d8d3Mz"');
    expect(page).toContain('api.conversions.pointImpact(point.id)');
    expect(page).toContain('過去の成果・金額・分析結果は削除しません');
    expect(page).toContain('過去実績を保持');
    expect(page).not.toContain("confirm('");
    expect(page).not.toContain('準備中');
    expect(createPage).not.toContain('準備中');
  });

  it('成果地点のKPI・未使用・利用先を、アフィリエイトの数と混ぜない', () => {
    for (const label of [
      '決めてある成果地点',
      'この30日の成果',
      '金額がついた成果',
      '1件も起きていない',
      'どこからも使われていない',
      '使われている場所',
    ]) expect(page).toContain(label);
    expect(page).not.toContain('確定報酬');
    expect(page).not.toContain('公開中の案件');
  });

  it('選択中LINEアカウントで一覧とレポートを読み直す', () => {
    expect(page).toContain('useAccount()');
    expect(page).toContain('api.conversions.points({ lineAccountId: selectedAccountId })');
    expect(page).toContain('api.conversions.report({ lineAccountId: selectedAccountId, startDate })');
    expect(page).toContain('}, [selectedAccountId, reload])');
  });
});
