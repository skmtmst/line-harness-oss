/**
 * migration が D1 の複合SELECTの上限(5項)を超えていないことを、全件で見張る(#713)。
 *
 * この試験が無いと、6 項以上の複合を書いても手元では全部緑のまま通り、
 * 検証環境へ当てたときに初めて `too many terms in compound SELECT` で止まる。
 * しかも止まった時点から後ろの migration が全部当たらなくなる。
 * 347 が実際にそれを起こした。
 *
 * 上限 5 の出どころは d1-sql-split.ts のコメントを見ること。実測値。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  D1_MAX_COMPOUND_SELECT,
  maxCompoundTerms,
  splitSqlIntoStatements,
} from './d1-sql-split.js';

const migrationsDir = join(import.meta.dirname, '..', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
}

describe('数える道具そのものの確かめ', () => {
  it('つないだ数だけ項として数える', () => {
    expect(maxCompoundTerms('SELECT 1')).toBe(1);
    expect(maxCompoundTerms('SELECT 1 UNION ALL SELECT 2')).toBe(2);
    expect(maxCompoundTerms(
      'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5',
    )).toBe(5);
    // D1 が落ちる形。上限ちょうどの次。
    expect(maxCompoundTerms(
      'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4'
      + ' UNION ALL SELECT 5 UNION ALL SELECT 6',
    )).toBe(6);
    expect(maxCompoundTerms('SELECT 1 INTERSECT SELECT 2 EXCEPT SELECT 3')).toBe(3);
  });

  it('括弧の内側は別の複合として数える(347 を割った形が通るのはこの理由)', () => {
    const nested = `
      WITH a AS (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4),
           b AS (SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8)
      SELECT * FROM a UNION ALL SELECT * FROM b`;
    // 4 項の塊が2つと、最後の 2 項。1本につなぐと 8 項だが、割れば 4 項。
    expect(maxCompoundTerms(nested)).toBe(4);
  });

  it('文字列やコメントの中の UNION は数えない', () => {
    expect(maxCompoundTerms(`SELECT 'UNION ALL UNION ALL' AS s`)).toBe(1);
    expect(splitSqlIntoStatements('-- UNION ALL UNION ALL\nSELECT 1;').length).toBe(1);
    expect(maxCompoundTerms(splitSqlIntoStatements('-- UNION ALL\nSELECT 1;')[0])).toBe(1);
  });

  it('トリガー本体の `;` では文を割らない', () => {
    const sql = `CREATE TRIGGER t AFTER INSERT ON x BEGIN UPDATE y SET a = 1; END;
      SELECT 1;`;
    expect(splitSqlIntoStatements(sql).length).toBe(2);
  });
});

describe('全 migration が D1 の複合SELECTの上限に収まっている', () => {
  const files = migrationFiles();

  it('見張る対象が空になっていない', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it(`どの文も複合SELECTは ${D1_MAX_COMPOUND_SELECT} 項以下`, () => {
    const over: string[] = [];
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      splitSqlIntoStatements(sql).forEach((statement, index) => {
        const terms = maxCompoundTerms(statement);
        if (terms > D1_MAX_COMPOUND_SELECT) {
          over.push(
            `${file} の ${index + 1} 文目: ${terms} 項`
            + `\n    ${statement.replace(/\s+/g, ' ').slice(0, 120)}`,
          );
        }
      });
    }
    expect(
      over,
      `D1 は複合SELECTを ${D1_MAX_COMPOUND_SELECT} 項までしか受け付けません。`
      + `\n以下の文は当てた時点で "too many terms in compound SELECT" で止まり、`
      + `\nそれ以降の migration が全部当たらなくなります。`
      + `\n括弧で括って分け、最後にまとめてください(347 が同じ形です)。\n`
      + over.join('\n'),
    ).toEqual([]);
  });
});
