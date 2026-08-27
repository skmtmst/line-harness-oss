import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = import.meta.dirname;
const page = readFileSync(join(root, 'page.tsx'), 'utf8');
const ads = readFileSync(join(root, 'ad-integration.tsx'), 'utf8');
const detail = readFileSync(join(root, 'detail', 'page.tsx'), 'utf8');

describe('V6 流入と計測', () => {
  it('上部タブと実Node IDを使い、本文に重複ヘッダーを置かない', () => {
    expect(page).toContain("links: 'Q4bkTg'");
    expect(page).toContain("script: 'IhSBB'");
    expect(page).toContain("ads: 'v0HaI'");
    expect(page).toContain('流入リンクを作る');
    expect(page).not.toContain("import Header from '@/components/layout/header'");
    expect(detail).toContain('data-design-node="JupxW"');
    expect(detail).not.toContain("import Header from '@/components/layout/header'");
  });

  it('押せない仮操作を出さず、未取得の値を作らない', () => {
    expect(page).not.toContain('準備中');
    expect(ads).not.toContain('準備中');
    expect(ads).not.toContain('連携を設定');
    expect(ads).not.toContain('接続設定');
    expect(ads).toContain("retry_wait: '再試行待ち'");
    expect(ads).toContain("l.attemptCount === undefined ? '—'");
  });
});
