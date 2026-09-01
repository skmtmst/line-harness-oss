/*
 * 「1件も無い」と「読み込めなかった」を、画面で言い分けているかの試験。
 *
 * 一覧はどれも `xs.length === 0` だけを見て「ありません。作成してください」と
 * 出していた。**読み込みに失敗したときも同じ文が出る。** 上には
 * 「読み込みに失敗しました」が並んでいるので、運用する人からは
 * 「登録したものが消えた」ように見える。実際、リマインダの画面を
 * ローカルで開いて、この2つが同時に出ているのを見つけた。
 *
 * ここでは**文字列そのものではなく、`error` で分岐しているか**を見る。
 * 文面は変わってよい。「失敗したのに『ありません』と言い切らない」ことだけを守る。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** 一覧の画面と、そこに出る「1件も無い」の文（の一部）。 */
const PAGES = [
  { file: 'reminders/page.tsx', empty: 'リマインダがありません' },
  { file: 'auto-replies/page.tsx', empty: '自動応答は0件です' },
  { file: 'broadcasts/page.tsx', empty: '配信がありません' },
];

/**
 * その文を含む JSX の式（`{ ... }`）を切り出す。
 *
 * 文の位置から左へ戻って、対応の取れていない `{` を探す。そこが式の頭。
 */
function enclosingExpression(src: string, needleIndex: number): string {
  let depth = 0;
  for (let i = needleIndex; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) return src.slice(i, needleIndex);
      depth -= 1;
    }
  }
  return src.slice(Math.max(0, needleIndex - 400), needleIndex);
}

describe('「1件も無い」と「読み込めなかった」', () => {
  for (const page of PAGES) {
    it(`${page.file} は、読み込みに失敗したときに「ありません」と言い切らない`, () => {
      const src = readFileSync(join(APP, page.file), 'utf8');
      const at = src.indexOf(page.empty);
      expect(at, `「${page.empty}」が見つからない。文面を変えたならこの試験も直す`).toBeGreaterThan(-1);

      const expr = enclosingExpression(src, at);
      // 失敗したかどうかを見ずに「ありません」と出していないか。
      expect(
        /\berror\b/.test(expr),
        `「${page.empty}」を出す式が error を見ていない。読み込みに失敗しても同じ文が出る`,
      ).toBe(true);
    });
  }
});
