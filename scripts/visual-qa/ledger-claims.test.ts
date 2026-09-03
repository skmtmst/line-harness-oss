/*
 * 台帳が書いている「無い」という主張が、いまも本当かの試験。
 *
 * 台帳には `status: 'unimplemented'` と一緒に理由が書いてある。
 * そのうち「`<道>` の page.tsx が development に存在しない」という形の主張は、
 * **ファイルの有無で機械的に確かめられる**。
 *
 * 実際に3件がずれていた（2026-09-03）。
 *   bPF0s  `/broadcasts/reserved`        … 在るのに「無い」と書かれ、撮らない画面のまま絵を出典にしていた
 *   ymXJK  `/nen-campaigns/columns/new`  … 同上
 *   P2J0Te `/friend-add-settings/runs`   … 無いのに注記が「未実装ではなくなった」と言っていた
 *
 * どれも**未マージのPRの枝で見たものを、本流の話として書いた**のが元。
 * 枝で見た観察は、本流に入るまで本流の判定にしない。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { SCREENS } from './screens.mjs';
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { ROOT } from './cited-shots.mjs';

type Screen = {
  node: string; name: string; route?: string; status?: string;
  why?: string; verdictSource?: string; verdictNote?: string;
};

const ALL = SCREENS as Screen[];

/** 「`/foo/bar` の page.tsx が development に存在しない」から道を取り出す。 */
const CLAIM = /`([^`]+)` の page\.tsx が development に存在しない/;

/** 道から、Next.js が読むファイルの置き場を出す。クエリは落とす。 */
function pageFile(route: string): string {
  const path = route.split('?')[0].replace(/^\//, '');
  return join(ROOT, 'apps', 'web', 'src', 'app', path, 'page.tsx');
}

describe('台帳の「無い」という主張', () => {
  it('「page.tsx が無い」と書いた画面は、本当に無い', () => {
    const wrong: string[] = [];
    for (const screen of ALL) {
      const hit = CLAIM.exec(screen.why ?? '');
      if (!hit) continue;
      if (existsSync(pageFile(hit[1]))) wrong.push(`${screen.node} ${hit[1]}`);
    }
    expect(wrong, `実物は在ります。status と why を直してください:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  it('撮らない画面を、絵で判定していない', () => {
    /*
      `status: 'unimplemented'` は「撮らない。合格にもしない」という決め。
      撮っていない画面の絵を出典に書けるのは、**別の枝で撮ったから**で、
      本流の判定の根拠にはならない。
    */
    const wrong = ALL
      .filter((s) => s.status === 'unimplemented' && /\.png/.test(s.verdictSource ?? ''))
      .map((s) => `${s.node} ${s.verdictSource}`);
    expect(wrong, `出典を、本流で確かめられるものに直してください:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  it('撮らない画面の注記が「未実装ではなくなった」と言っていない', () => {
    const wrong = ALL
      .filter((s) => s.status === 'unimplemented' && /未実装ではなくなった/.test(s.verdictNote ?? ''))
      .map((s) => `${s.node} ${s.name}`);
    expect(wrong, `status と注記が食い違っています:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });
});
