/**
 * D1 へ送る SQL を、wrangler と同じ切り方で文に割り、複合SELECTの項数を数える。
 *
 * なぜ要るか(#713)。
 * D1(workerd)の SQLite は `SQLITE_MAX_COMPOUND_SELECT` が **5** で、
 * 6 項以上の `UNION` / `INTERSECT` / `EXCEPT` を含む文は
 * `too many terms in compound SELECT` で落ちる。表の有無やデータに関係なく、
 * 構文の段階で落ちる。
 *
 * この 5 という数字は推測ではなく実測値。`wrangler d1 execute --local`
 * (miniflare/workerd の D1)へ `SELECT 1 UNION ALL SELECT 1 ...` を項数を
 * 変えて投げ、5 項は通り 6 項から落ちることを確かめた。
 *
 * 手元の SQLite の既定は 500 で、`better-sqlite3` も `sqlite3` CLI も既定のまま。
 * つまり **手元のどの試験も、この種の不具合を素通りさせる**。
 * migration 347 はこれで検証環境のスキーマ全体を止めた。
 * だからここで数えて見張る。
 */

/** D1(workerd)の SQLITE_MAX_COMPOUND_SELECT。実測値。 */
export const D1_MAX_COMPOUND_SELECT = 5;

// --- ここから下は wrangler 4.77.0 の src/d1/splitter.ts と同じ切り方 ---
// wrangler がファイルを文に割ってから D1 へ送るので、数える単位を合わせる。
// トリガー本体(BEGIN ... END)や CASE ... END の中の `;` では割らない。

/**
 * 終わりの印が出るまで読み進める(印そのものも含めて返す)。
 *
 * 印は 1〜2 文字なので末尾だけを見る。積み上げた文字列に毎文字
 * `endsWith` を掛けると、長いコメントや文字列で O(k^2) になる。
 */
function consumeUntilMarker(iterator: Iterator<string>, endMarker: string): string {
  const parts: string[] = [];
  let tail = '';
  let next = iterator.next();
  while (!next.done) {
    parts.push(next.value);
    tail = (tail + next.value).slice(-endMarker.length);
    if (tail === endMarker) break;
    next = iterator.next();
  }
  return parts.join('');
}

// 開始・終了の判定はどちらも末尾しか見ない正規表現なので、末尾の数文字だけ渡す。
const START_TAIL = 8; // " BEGIN " が入る長さ
const END_TAIL = 6;   // " END; " が入る長さ
const isCompoundStatementStart = (str: string): boolean =>
  /\s(BEGIN|CASE)\s$/i.test(str);
const isCompoundStatementEnd = (str: string): boolean =>
  /\sEND[;\s]$/.test(str);

export function splitSqlIntoStatements(sql: string): string[] {
  const statements: string[] = [];
  let str = '';
  // 末尾だけを別に持つ。積み上げた文字列を毎文字 slice すると、
  // 内部表現の平坦化が毎回走って全 migration の走査が桁違いに遅くなる。
  let tail = '';
  const append = (chunk: string): void => {
    str += chunk;
    tail = (tail + chunk).slice(-START_TAIL);
  };
  const stack: Array<(s: string) => boolean> = [];
  const iterator = sql[Symbol.iterator]();
  let next = iterator.next();
  while (!next.done) {
    const char = next.value;
    if (stack[0]?.(tail.slice(-END_TAIL) + char)) stack.shift();
    switch (char) {
      case `'`:
      case `"`:
      case '`':
        append(char + consumeUntilMarker(iterator, char));
        break;
      case '-':
        next = iterator.next();
        if (!next.done && next.value === '-') {
          consumeUntilMarker(iterator, '\n');
          append('\n');
          break;
        }
        append(char);
        continue;
      case '/':
        next = iterator.next();
        if (!next.done && next.value === '*') {
          consumeUntilMarker(iterator, '*/');
          break;
        }
        append(char);
        continue;
      case ';':
        if (stack.length === 0) {
          statements.push(str);
          str = '';
          tail = '';
        } else {
          append(char);
        }
        break;
      default:
        append(char);
        break;
    }
    if (isCompoundStatementStart(tail)) stack.unshift(isCompoundStatementEnd);
    next = iterator.next();
  }
  statements.push(str);
  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 文字列リテラルを外す。中の UNION を数えないため。 */
function stripStringLiterals(sql: string): string {
  let out = '';
  const iterator = sql[Symbol.iterator]();
  let next = iterator.next();
  while (!next.done) {
    const char = next.value;
    if (char === `'` || char === `"` || char === '`') {
      consumeUntilMarker(iterator, char);
      out += ' ';
    } else {
      out += char;
    }
    next = iterator.next();
  }
  return out;
}

/**
 * 1つの文の中で、いちばん項の多い複合SELECTの項数を返す。
 *
 * 括弧の内側は別の複合として数える。`(A UNION B) UNION (C UNION D)` は
 * 4 項ではなく 2 項。D1 の上限も入れ子ごとに見るので、この数え方で合う。
 */
export function maxCompoundTerms(statement: string): number {
  const sql = stripStringLiterals(statement);
  const stack: number[] = [0];
  let max = 1;
  const token = /\(|\)|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(sql)) !== null) {
    const text = match[0];
    if (text === '(') {
      stack.push(0);
    } else if (text === ')') {
      const closed = stack.pop() ?? 0;
      if (closed + 1 > max) max = closed + 1;
      if (stack.length === 0) stack.push(0);
    } else {
      stack[stack.length - 1] += 1;
    }
  }
  while (stack.length > 0) {
    const closed = stack.pop() ?? 0;
    if (closed + 1 > max) max = closed + 1;
  }
  return max;
}
