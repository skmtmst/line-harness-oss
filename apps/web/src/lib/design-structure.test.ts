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

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(SRC, 'app');

/**
 * `data-design="..."` を書かれた順に集める。
 *
 * JSX の入れ子は追わない。節の印は最上位にだけ付ける決まりなので、
 * 出てくる順がそのまま並びになる。
 */
function designMarkers(source: string): string[] {
  return [...new Set([...source.matchAll(/data-design="([^"]+)"/g)].map((m) => m[1]))].sort();
}

const LEGACY_SCREENS = Object.entries(structure.screens) as Array<
  [
    string,
    {
      node: string;
      name: string;
      sections: string[];
      parts?: string[];
      implementationGaps?: {
        sections?: string[];
        parts?: string[];
        reason: string;
      };
    },
  ]
>;

// この6画面はV8の作り直しで旧V6/V7の節・文言を置き換えた。
// JSONの旧画面へ戻す要求にせず、現在のV8の節・検索・空状態を見張る。
const V8_SECTIONS: Record<string, string[]> = {
  '/hq/members': ['Table'],
  '/broadcasts/new': [],
  '/settings': ['theme-preview', '機能の一覧'],
  '/ec-commerce': ['Head'],
  '/form-submissions': [],
  '/friends/detail': ['Left', 'Right'],
  // ★V8 友だち属性の作る画面（d9xoI・w9zY5・GobMd）は src/v8/tags に一から書き、型（CreatePage）が節を持つ。
  // 残る印は v7 の画面（同じ page.tsx の中）のもの。
  '/tags/new': [],
  '/tags/fields/new': ['Basic', 'Immutable', 'Value'],
  '/tags/fields/migrate': ['Fields', 'Preview', 'Result', 'Usage'],
}
const V8_COPY: Record<string, Record<string, string>> = {
  '/hq/members': { '担当アカウントの割り当て': '担当範囲' },
  '/staff': { '人の名前・メールで検索': '名前・メールで探す' },
  // ★V8 ywFJT：区分の頭のボタンは「まとめて」。
  '/settings': { 'まとめて切替': 'まとめて' },
  '/ec-commerce': { '取り込みの記録を探す': '取り込みの記録を検索' },
  '/form-submissions': {
    '回答の保存先': '保存先',
    'まだフォームがありません': 'まだ回答フォームはありません',
    '最初の1つを作ると、集まった回答もここから見られます。': '答えは友だち情報に保存できます。',
  },
}
const SCREENS = LEGACY_SCREENS.map(([route, spec]) => [route, {
  ...spec,
  name: route in V8_SECTIONS ? spec.name.replace(/^V6|^V7/, 'V8') : spec.name,
  sections: V8_SECTIONS[route] ?? spec.sections,
  parts: spec.parts?.map((part) => V8_COPY[route]?.[part] ?? part),
}] as const)

/** 1ファイルぶんの import 先を、実ファイルの絶対パスにして返す。 */
function importedFiles(file: string, source: string): string[] {
  const files: string[] = [];
  const push = (base: string) => {
    for (const ext of ['.tsx', '.ts', '/page.tsx']) {
      try {
        readFileSync(base + ext, 'utf8');
        files.push(base + ext);
        return;
      } catch {
        // その名前のファイルが無いだけ。次の拡張子を試す。
      }
    }
  };
  // lib も辿る。選択肢の定義（リッチメニューのレイアウトなど）を lib に
  // 置いている画面があり、@/components と @/app だけでは中身を読めない。
  // V8 の画面は src/v8 に一から書く（2026-10-06）。入口の page.tsx は @/v8 を読むだけなので、そこも辿る。
  for (const m of source.matchAll(/from '@\/(components|app|lib|v8)\/([^']+)'/g)) {
    push(join(SRC, m[1], m[2]));
  }
  // 画面の中身を同じフォルダのファイルに出していることがある
  // （scenarios/detail は page.tsx が薄く、実体は scenario-detail-client.tsx）。
  // 親フォルダの共有部品（conversions/new から ../origin-labels など）も辿る。
  // 起点の説明・除外条件の読み取りは親に置き、作成・一覧・詳細・編集で共用する。
  for (const m of source.matchAll(/from '(\.\/|\.\.\/)([^']+)'/g)) {
    push(join(dirname(file), m[1], m[2]));
  }
  // 速さのためタブの中身を後読みにしている画面がある（予約設定の
  // settings-tabs）。動的 import は静的 import と同じく中身を読む。
  for (const m of source.matchAll(/import\(\s*['`](\.\/|\.\.\/)([^'`]+)['`]/g)) {
    push(join(dirname(file), m[1], m[2]));
  }
  return files;
}

/**
 * その画面が読み込む部品も含めて、文字列を集める。
 *
 * 節を別ファイルに切り出していると、page.tsx を読むだけでは
 * 中身の語が見つからない。import を **2段** 辿る。
 *
 * 1段では足りない。page.tsx が「本体の部品を1つ読むだけ」の薄い入口に
 * なっている画面があり（/tags は `tags-page-v4.tsx` を読むだけ）、
 * その本体が読む一覧・ダイアログは2段目に来る。1段で止めていたころは、
 * 入口に残っていた**描かれない旧コード**の import が偶然1段目を埋めていて、
 * この検査は画面ではなく死んだコードを見ていた。
 */
function readWithParts(route: string): string {
  const start = join(route === '/' ? APP : join(APP, route), 'page.tsx');
  const seen = new Set<string>();
  let frontier = [start];
  let combined = '';
  for (let depth = 0; depth <= 2; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      if (seen.has(file)) continue;
      seen.add(file);
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      combined += source;
      for (const imported of importedFiles(file, source)) {
        if (!seen.has(imported)) next.push(imported);
      }
    }
    frontier = next;
  }
  return combined;
}

describe('画面の骨格が設計と一致する', () => {
  it('対象の画面が登録されている', () => {
    // JSON が空になったら、以下の検査が素通りしてしまう。
    expect(SCREENS.length).toBeGreaterThan(0);
  });

  it.each([
    ['/broadcasts/new', 'data-design-node="FU2aU"'],
    // 2026-10-06：一覧は src/v8/forms/list に一から書いた。板の印は型（ListPage）の boardId で付ける。
    ['/form-submissions', "boardId={narrow ? 'GrnO4' : 'I3L41O'}"],
  ])('%s はV8の画面を読み込む', (route, marker) => {
    expect(readWithParts(route)).toContain(marker);
  });

  it.each(SCREENS)('%s（%s）', (route, spec) => {
    // 骨組みを共通の部品に出している画面がある（作成画面の Crumb / Head /
    // Body / Left / Right は create-page.tsx にある）。page.tsx だけ見ると
    // 「印が付いていない」ことになるので、読み込んでいる部品も一緒に見る。
    const markers = designMarkers(readWithParts(route));
    const sectionGaps = spec.implementationGaps?.sections ?? [];
    const expected = spec.sections.filter((section) => !sectionGaps.includes(section)).sort();
    expect(sectionGaps.every((section) => spec.sections.includes(section))).toBe(true);
    expect(
      markers,
      [
        `${spec.name}（node ${spec.node}）の骨格が設計と違います。`,
        `設計にある節: ${spec.sections.join(' → ')}`,
        `実装にある節: ${markers.length ? markers.join(', ') : '（印が付いていません）'}`,
        `記録済みの未実装: ${sectionGaps.join(', ') || 'なし'}`,
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
    const recordedGaps = spec.implementationGaps?.parts ?? [];
    expect(recordedGaps.every((part) => spec.parts?.includes(part))).toBe(true);
    if (recordedGaps.length > 0) expect(spec.implementationGaps?.reason.trim()).toBeTruthy();
    expect(
      missing,
      [
        `${spec.name}（node ${spec.node}）に、設計にある語が見つかりません。`,
        `無い語: ${missing.join(', ')}`,
        '',
        `記録済みの未実装: ${recordedGaps.join(', ') || 'なし'}`,
        'データが無いときも「未設定」「まだありません」と出してください。',
        '節ごと消すと、画面にその機能が無いように見えます。',
      ].join('\n'),
    ).toEqual(recordedGaps);
  });
});
