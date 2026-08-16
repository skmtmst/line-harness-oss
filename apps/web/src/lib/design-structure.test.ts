import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import structure from './design-structure.json';

/**
 * 画面の骨格が設計と一致していることを確かめる。
 *
 * これが無かったせいで、KPIだけ足して「設計どおりになった」と誤って
 * 判断し、古い部品（赤い警告帯・LINE/メールのタブ・縦に伸びた入力欄）が
 * 残ったままになった。人がスクリーンショットを見るまで誰も気づけなかった。
 *
 * 仕組みは単純で、実装側の各節に `data-design="Head"` のような印を付け、
 * その集合が設計（design-structure.json）と一致するかを見る。
 *
 * **並びは見ない。** 1つのファイルに複数のコンポーネントが定義されていると、
 * ソース上の出現順と実際の描画順が一致しない（受信箱は内側の関数が
 * 先に書かれている）。並びまで縛ろうとすると、ファイルの書き方を
 * 制約することになって本末転倒。
 *
 * 「どの節があるか」が合っていれば、抜けと余りは捕まえられる。
 * 並びのずれは人が見て気づく方が早い。
 *
 * 設計を変えたときは JSON も一緒に直す。そのとき差分に
 * 「設計を更新した」ことが残るので、実装が勝手にずれたのか
 * 設計が動いたのかを後から区別できる。
 */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** ルートから page.tsx の中身を読む。 */
function readScreen(route: string): string {
  const dir = route === '/' ? APP : join(APP, route);
  return readFileSync(join(dir, 'page.tsx'), 'utf8');
}

/**
 * `data-design="..."` を書かれた順に集める。
 *
 * JSX の入れ子は追わない。節の印は最上位にだけ付ける決まりなので、
 * 出てくる順がそのまま並びになる。
 */
function designMarkers(source: string): string[] {
  return [...new Set([...source.matchAll(/data-design="([^"]+)"/g)].map((m) => m[1]))].sort();
}

const SCREENS = Object.entries(structure.screens) as Array<
  [string, { node: string; name: string; sections: string[] }]
>;

describe('画面の骨格が設計と一致する', () => {
  it('対象の画面が登録されている', () => {
    // JSON が空になったら、以下の検査が素通りしてしまう。
    expect(SCREENS.length).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s（%s）', (route, spec) => {
    const markers = designMarkers(readScreen(route));
    const expected = [...spec.sections].sort();
    expect(
      markers,
      [
        `${spec.name}（node ${spec.node}）の骨格が設計と違います。`,
        `設計にある節: ${spec.sections.join(' → ')}`,
        `実装にある節: ${markers.length ? markers.join(', ') : '（印が付いていません）'}`,
        `足りない: ${expected.filter((x) => !markers.includes(x)).join(', ') || 'なし'}`,
        `設計に無い: ${markers.filter((x) => !expected.includes(x)).join(', ') || 'なし'}`,
        '',
        '実装側の各節に data-design="Head" のような印を付けてください。',
        '設計そのものを変えたときは design-structure.json も直してください。',
      ].join('\n'),
    ).toEqual(expected);
  });
});
