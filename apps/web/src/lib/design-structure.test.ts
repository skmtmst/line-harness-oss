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
  [
    string,
    {
      node: string;
      name: string;
      sections: string[];
      parts?: string[];
      visualVerification?: {
        status: 'verified' | 'unverified' | 'blocked';
        referenceNodeIds: string[];
        requiredViewports: number[];
        reason?: string;
        blockingIssues?: string[];
        referenceScreenshots?: string[];
        implementationScreenshots?: string[];
        checkedAt?: string;
      };
    },
  ]
>;

const REAL_NODE_ID = /^[A-Za-z0-9]{5,6}$/;

/**
 * その画面が読み込む部品も含めて、文字列を集める。
 *
 * 節を別ファイルに切り出していると、page.tsx を読むだけでは
 * 中身の語が見つからない。import しているものを1段だけ辿る。
 */
function readWithParts(route: string): string {
  const source = readScreen(route);
  let combined = source;
  // lib も辿る。選択肢の定義（リッチメニューのレイアウトなど）を lib に
  // 置いている画面があり、@/components と @/app だけでは中身を読めない。
  for (const m of source.matchAll(/from '@\/(components|app|lib)\/([^']+)'/g)) {
    for (const ext of ['.tsx', '.ts', '/page.tsx']) {
      const file = join(dirname(fileURLToPath(import.meta.url)), '..', m[1], m[2] + ext);
      try {
        combined += readFileSync(file, 'utf8');
        break;
      } catch {
        // その名前のファイルが無いだけ。次の拡張子を試す。
      }
    }
  }
  // 画面の中身を同じフォルダのファイルに出していることがある
  // （scenarios/detail は page.tsx が薄く、実体は scenario-detail-client.tsx）。
  // 相対 import も1段だけ辿る。
  const dir = route === '/' ? APP : join(APP, route);
  for (const m of source.matchAll(/from '\.\/([^']+)'/g)) {
    for (const ext of ['.tsx', '.ts']) {
      try {
        combined += readFileSync(join(dir, m[1] + ext), 'utf8');
        break;
      } catch {
        // その名前のファイルが無いだけ。次の拡張子を試す。
      }
    }
  }
  return combined;
}

describe('画面の骨格が設計と一致する', () => {
  it('対象の画面が登録されている', () => {
    // JSON が空になったら、以下の検査が素通りしてしまう。
    expect(SCREENS.length).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s（%s）', (route, spec) => {
    // 骨組みを共通の部品に出している画面がある（作成画面の Crumb / Head /
    // Body / Left / Right は create-page.tsx にある）。page.tsx だけ見ると
    // 「印が付いていない」ことになるので、読み込んでいる部品も一緒に見る。
    const markers = designMarkers(readWithParts(route));
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

  /**
   * 節の中身。
   *
   * 骨格が合っていても、中身が「データが無いと消える」作りだと
   * 実際の画面からは節ごと無くなる。実際に友だち詳細で4節が消えていて、
   * 人が見るまで気づけなかった。
   *
   * データが無いときも「未設定」「まだありません」と出す決まりにしたので、
   * ここに書いた語が消えることは無い。
   */
  it.each(SCREENS.filter(([, s]) => s.parts?.length))('%s の節の中身', (route, spec) => {
    const source = readWithParts(route);
    const missing = (spec.parts ?? []).filter((part) => !source.includes(part));
    expect(
      missing,
      [
        `${spec.name}（node ${spec.node}）に、設計にある語が見つかりません。`,
        `無い語: ${missing.join(', ')}`,
        '',
        'データが無いときも「未設定」「まだありません」と出してください。',
        '節ごと消すと、画面にその機能が無いように見えます。',
      ].join('\n'),
    ).toEqual([]);
  });
});

describe('V4の視覚一致を機能・文字列テストと混同しない', () => {
  const v4Screens = SCREENS.filter(([, spec]) => spec.name.startsWith('V4'));

  it('V4画面は視覚検証の状態を必ず記録する', () => {
    expect(v4Screens.length).toBeGreaterThan(0);

    for (const [route, spec] of v4Screens) {
      expect(spec.visualVerification, `${route} に visualVerification がありません`).toBeDefined();
      expect(
        spec.visualVerification?.requiredViewports,
        `${route} は1440pxと1920pxの確認が必要です`,
      ).toEqual(expect.arrayContaining([1440, 1920]));
    }
  });

  it('画面名をノードIDの代わりにしたV4はblocked以外にできない', () => {
    for (const [route, spec] of v4Screens) {
      const nodeTokens = spec.node.split(/\s+/).filter(Boolean);
      const hasPlaceholder = nodeTokens.some((node) => !REAL_NODE_ID.test(node));
      if (hasPlaceholder) {
        expect(
          spec.visualVerification?.status,
          `${route} の node は実ノードIDではありません。実ID取得までblockedにしてください`,
        ).toBe('blocked');
      }
    }
  });

  it('blockedとunverifiedには未完了の理由があり、verifiedには比較証拠がある', () => {
    for (const [route, spec] of v4Screens) {
      const verification = spec.visualVerification;
      expect(verification).toBeDefined();
      if (!verification) continue;

      if (verification.status === 'blocked') {
        expect(
          verification.blockingIssues?.length,
          `${route} は止まっている理由を記録してください`,
        ).toBeGreaterThan(0);
        continue;
      }

      if (verification.status === 'unverified') {
        expect(
          verification.reason?.trim().length,
          `${route} は未検証の理由を記録してください`,
        ).toBeGreaterThan(0);
        continue;
      }

      expect(
        verification.referenceNodeIds.every((node) => REAL_NODE_ID.test(node)),
        `${route} の実ノードIDを記録してください`,
      ).toBe(true);
      expect(
        verification.referenceScreenshots?.length,
        `${route} のPen.dev比較画像を記録してください`,
      ).toBeGreaterThan(0);
      expect(
        verification.implementationScreenshots?.length,
        `${route} の実装比較画像を記録してください`,
      ).toBeGreaterThan(0);
      expect(verification.checkedAt, `${route} の比較日時を記録してください`).toBeTruthy();
    }
  });
});
