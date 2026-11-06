/*
 * D1 の SQLITE_MAX_COMPOUND_SELECT は実測5項で、better-sqlite3 の既定500項とは異なるため、実行時 SQL の UNION / UNION ALL の項数を走査する。
 * Worker と packages/db/src の SQL を対象にする。マイグレーションは別の検査が担当する。
 * 独立した CTE の UNION 数を合算しないよう、括弧へ入るたびにカウンタを積み、閉じるとそのブロックだけを確定する。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/** D1 の SQLITE_MAX_COMPOUND_SELECT。wrangler d1 execute --local で実測。 */
const D1_MAX_COMPOUND_SELECT_TERMS = 5;

/**
 * Worker と DB 共通処理の実行時 SQL をともに検査する。label は違反箇所がどちらの配下かを示す。
 */
const SCAN_ROOTS = [
  { label: 'apps/worker/src', dir: join(process.cwd(), 'src') },
  { label: 'packages/db/src', dir: join(process.cwd(), '../../packages/db/src') },
];

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
 * ファイル内の文字列リテラル（テンプレートリテラル `` ` `` と、単一引用符
 * `'...'` の通常の文字列の両方）を、TypeScriptのASTから正確に抜き出す。
 *
 * 最初は `indexOf('\`')` を単純にペアリングする実装にしていたが、
 * コメント中のインラインコード表記（例: `` `%` `` `` `_` ``）が
 * バッククォートとして誤って対になり、本物のSQLテンプレートリテラルの
 * 境界がズレて中身が読めなくなった（逆変異を当てて確かめて見つけた）。
 * コメントはASTに現れないので、AST走査ならこの誤りが起きない。
 *
 * 単一引用符も拾う理由: `db.prepare('SELECT ...')` のように文字列を
 * `'...'` で書くことも実際にある（例: `routes/tenants.ts`）。長い
 * compound SELECT を1行の引用符で書く人はまず居らず穴は狭いが、走査が
 * 「テンプレートリテラルだけ」だと素通りしてしまう分は塞いでおく。
 */
function extractTemplateLiterals(source: string, fileName: string): string[] {
  const out: string[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
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
  // 545件超のTSをAST走査するためCIの並列負荷で5秒既定を超えることがある。判定は変えず制限だけ延ばす。
  test('apps/worker/src・packages/db/src 配下（試験を除く）を走査して、超えるものが無いことを確かめる', { timeout: 30000 }, () => {
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      const files = listSourceFiles(root.dir);
      // 走査自体が空振りしていないことの確認。ルートごとに見る
      // （合計で見ると、片方が0件でも足し合わせで超えてしまい気づけない）。
      expect(files.length, `${root.label} の走査対象が少なすぎます`).toBeGreaterThan(50);

      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const literal of extractTemplateLiterals(source, file)) {
          // SQLらしくない（UNIONを含まない）文字列は、そもそも項数1で
          // 問題にならない。analyzeCompoundBlocksへ全部通しても軽い。
          for (const block of analyzeCompoundBlocks(literal)) {
            if (block.terms > D1_MAX_COMPOUND_SELECT_TERMS) {
              violations.push(
                `${root.label}/${relative(root.dir, file)}: ${block.terms}項 — "${block.snippet}..."`,
              );
            }
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
