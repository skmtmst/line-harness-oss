import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 設計ノードID対応表（docs/design-node-ids.md）に書いたルートが、
 * 実際に存在することを確かめる。
 *
 * 対応表は「どの設計を見て、どの画面を直すか」の唯一の入口。
 * ここが実装とずれると、次に作業する人が存在しない画面を探すことになる。
 *
 * 特に動的セグメント（`/friends/[id]`）は書きたくなるが、この管理画面は
 * 静的書き出しなので書き出せない。対応表に紛れ込むと、それを見た人が
 * `[id]` で作り、route-integrity.test.ts に落とされる。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DOC = join(ROOT, 'docs', 'design-node-ids.md');
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

interface Row {
  screen: string;
  node: string;
  route: string;
}

/**
 * 対応表からルート付きの行を読む。
 *
 * スマホ（MV2）とタブレット（TV2）の表は3列目が「対応するPC画面のID」で
 * ルートではない。`/` で始まる行だけを見る。
 */
function readRows(): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(DOC, 'utf8').split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`(\/[^`]*)`\s*\|/.exec(line);
    if (m) rows.push({ screen: m[1], node: m[2], route: m[3] });
  }
  return rows;
}

/** クエリとハッシュを落として、画面のパスだけにする。 */
function toPath(route: string): string {
  const path = route.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

const ROWS = readRows();

describe('設計ノードID対応表', () => {
  it('ルート付きの行が読める', () => {
    // 表の書式が変わって0件になったら、以下の検査が素通りしてしまう。
    expect(ROWS.length).toBeGreaterThan(50);
  });

  it('動的セグメントを書いていない', () => {
    // 静的書き出しでは `[id]` を書き出せない。詳細画面は ?id= で表す。
    const dynamic = ROWS.filter((r) => r.route.includes('[') || r.route.includes(']'));
    expect(
      dynamic.map((r) => `${r.screen} → ${r.route}`),
      '動的セグメントのルートがあります。?id= の形にしてください',
    ).toEqual([]);
  });

  it('書いてあるルートの画面がすべて実在する', () => {
    const missing = ROWS.filter((r) => {
      const path = toPath(r.route);
      const dir = path === '/' ? APP : join(APP, path);
      return !existsSync(join(dir, 'page.tsx'));
    });
    expect(
      missing.map((r) => `${r.screen} → ${r.route}`),
      '対応表のルートに画面がありません',
    ).toEqual([]);
  });

  it('ノードIDが重複していない', () => {
    // 同じ設計ノードを2つの画面に割り当てていると、どちらを直すべきか
    // 分からなくなる。
    const nodes = ROWS.map((r) => r.node);
    const duplicated = nodes.filter((n, i) => nodes.indexOf(n) !== i);
    expect([...new Set(duplicated)]).toEqual([]);
  });
});
