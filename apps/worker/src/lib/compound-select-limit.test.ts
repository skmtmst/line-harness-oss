/*
 * 実行時SQLの compound SELECT（`UNION` / `UNION ALL`）が、D1 の
 * `SQLITE_MAX_COMPOUND_SELECT` を超えていないことを走査する試験（票 #717）。
 *
 * 上限5という数字の出どころ: D1 の `SQLITE_MAX_COMPOUND_SELECT` を
 * `wrangler d1 execute --local` で実測した値（手元の better-sqlite3 は
 * 既定500なので、この試験が無いと素通りする）。
 *
 * 実際に起きた不具合（N-717）は、`apps/worker/src/routes/friends.ts` の
 * 友だちタイムラインの問い合わせが8項の compound SELECT になっており、
 * better-sqlite3 を使う手元の試験ではどれも気づけなかった、というもの。
 * この試験は「次に誰かが6項以上の compound SELECT を書いた瞬間に赤くなる」
 * 蓋として置く（migration 側の同種の走査は #713 が
 * `packages/db/migrations/` に対して作る。対象がここと重ならない：
 * こちらは実行時SQL）。
 *
 * 括弧の深さごとに独立したカウンタを持たせている理由: 例えば
 *   WITH group_a AS ( SELECT ... UNION ALL SELECT ... UNION ALL SELECT ... )
 *   ...
 * のように、同じ深さに複数の独立した括弧ブロックがあるとき、
 * 深さだけでグルーピングすると別ブロックの UNION 数を合算してしまう
 * （false positive）。ネストのたびに新しいカウンタを積み、閉じ括弧で
 * そのブロックだけの項数を確定させることで、CTE で正しく割ったクエリは
 * 誤検知しない。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/** D1 の SQLITE_MAX_COMPOUND_SELECT。wrangler d1 execute --local で実測。 */
const D1_MAX_COMPOUND_SELECT_TERMS = 5;

const SRC_ROOT = join(process.cwd(), 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (extname(full) !== '.ts' && extname(full) !== '.tsx') continue;
    if (full.endsWith('.test.ts') || full.endsWith('.test.tsx')) continue;
    out.push(full);
  }
  return out;
}

/**
 * ファイル内のテンプレートリテラル（`` ` `` 文字列）を、TypeScriptの
 * AST から正確に抜き出す。
 *
 * 最初は `indexOf('\`')` を単純にペアリングする実装にしていたが、
 * コメント中のインラインコード表記（例: `` `%` `` `` `_` ``）が
 * バッククォートとして誤って対になり、本物のSQLテンプレートリテラルの
 * 境界がズレて中身が読めなくなった（逆変異を当てて確かめて見つけた）。
 * コメントはASTに現れないので、AST走査ならこの誤りが起きない。
 */
function extractTemplateLiterals(source: string, fileName: string): string[] {
  const out: string[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // `head ${expr} middle ${expr} tail` 形。埋め込み式は構造を
      // 壊さないよう1文字へ潰して繋ぐ（analyzeCompoundBlocks側でも
      // 同じ扱いをしているが、ここでも念のため揃えておく）。
      let text = node.head.text;
      for (const span of node.templateSpans) {
        text += 'X' + span.literal.text;
      }
      out.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

interface CompoundBlockResult {
  terms: number;
  /** そのブロックの先頭付近の文字列（報告用）。 */
  snippet: string;
}

/**
 * 1つの文字列（SQLの可能性がある）の中で、括弧の深さごとに
 * UNION / UNION ALL を数え、各ブロックの項数（UNION数 + 1）を返す。
 * SQL以外の文字列を渡しても、単に UNION が0個のブロックとして
 * 扱われるだけで安全（誤検知しない）。
 */
function analyzeCompoundBlocks(text: string): CompoundBlockResult[] {
  // `${...}` の埋め込み式は構造を壊さないよう1文字へ潰す（括弧が
  // 埋め込み式の中にあってもここで消えるので、外側の対応関係は崩れない）。
  const cleaned = text.replace(/\$\{[^}]*\}/g, 'X');
  const results: CompoundBlockResult[] = [];
  const stack: Array<{ unions: number; start: number }> = [{ unions: 0, start: 0 }];
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === '(') {
      stack.push({ unions: 0, start: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      // 対応する開き括弧が無い ')' は、SQLでない文字列（絵文字・普通の
      // 説明文など）に稀にある。走査対象はテンプレートリテラル全般であって
      // SQLだけではないので、深さがマイナスにならないよう無視する。
      if (stack.length > 1) {
        const frame = stack.pop()!;
        results.push({
          terms: frame.unions + 1,
          snippet: cleaned.slice(frame.start, Math.min(frame.start + 80, cleaned.length)).replace(/\s+/g, ' '),
        });
      }
      i += 1;
      continue;
    }
    if (/[Uu]/.test(ch) && /^union\b/i.test(cleaned.slice(i, i + 6))) {
      const top = stack[stack.length - 1];
      top.unions += 1;
      i += 5; // 'union'.length
      continue;
    }
    i += 1;
  }
  const top = stack[0];
  results.push({
    terms: top.unions + 1,
    snippet: cleaned.slice(0, Math.min(80, cleaned.length)).replace(/\s+/g, ' '),
  });
  return results;
}

describe(`実行時SQLの compound SELECT が D1 の上限(${D1_MAX_COMPOUND_SELECT_TERMS}項)を超えない`, () => {
  test('apps/worker/src 配下（試験を除く）を走査して、超えるものが無いことを確かめる', () => {
    const files = listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(100); // 走査自体が空振りしていないことの確認。

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const literal of extractTemplateLiterals(source, file)) {
        // SQLらしくない（UNIONを含まない）文字列は、そもそも項数1で
        // 問題にならない。analyzeCompoundBlocksへ全部通しても軽い。
        for (const block of analyzeCompoundBlocks(literal)) {
          if (block.terms > D1_MAX_COMPOUND_SELECT_TERMS) {
            violations.push(
              `${relative(SRC_ROOT, file)}: ${block.terms}項 — "${block.snippet}..."`,
            );
          }
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('走査ロジック自体の自己点検: 6項のUNION ALLを検知できる', () => {
    const sql = `SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6`;
    const blocks = analyzeCompoundBlocks(sql);
    expect(Math.max(...blocks.map((b) => b.terms))).toBe(6);
  });

  test('走査ロジック自体の自己点検: 4項+4項をCTEで割った形は5項超えとして検知しない', () => {
    const sql = `WITH a AS (
      SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
    ), b AS (
      SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
    )
    SELECT * FROM (SELECT * FROM a UNION ALL SELECT * FROM b)`;
    const blocks = analyzeCompoundBlocks(sql);
    expect(Math.max(...blocks.map((b) => b.terms))).toBe(4);
  });
});
