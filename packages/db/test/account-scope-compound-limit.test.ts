import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function stripSqlLiteralsAndComments(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
}

function compoundOperatorCounts(sql: string): number[] {
  const counts: number[] = [];
  const stack = [0];
  const tokens = stripSqlLiteralsAndComments(sql).matchAll(
    /[();]|\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/gi,
  );
  for (const [token] of tokens) {
    if (token === '(') {
      stack.push(0);
    } else if (token === ')') {
      expect(stack.length, 'unmatched closing parenthesis').toBeGreaterThan(1);
      counts.push(stack.pop()!);
    } else if (token === ';') {
      expect(stack.length, 'unclosed parenthesis at statement end').toBe(1);
      counts.push(stack[0]);
      stack[0] = 0;
    } else {
      stack[stack.length - 1] += 1;
    }
  }
  expect(stack.length, 'unclosed parenthesis at end of SQL').toBe(1);
  return [...counts, stack[0]];
}

describe('compound SELECT counter', () => {
  it.each(['UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT'])(
    'detects a five-term flat %s compound',
    (operator) => {
      const sql = Array.from({ length: 5 }, (_, i) => `SELECT ${i}`).join(` ${operator} `);
      expect(compoundOperatorCounts(sql)).toEqual([4]);
    },
  );

  it('counts sibling CTEs separately from their combining SELECT', () => {
    const counts = compoundOperatorCounts(`
      WITH a(id) AS (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4),
           b(id) AS (SELECT 5 UNION SELECT 6)
      SELECT id FROM a UNION SELECT id FROM b;
    `);
    expect(Math.max(...counts)).toBe(3);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5);
  });

  it('keeps the enclosing compound count when a subquery closes', () => {
    expect(compoundOperatorCounts(
      'SELECT 1 UNION SELECT (SELECT 2 UNION SELECT 3) UNION SELECT 4 UNION SELECT 5 UNION SELECT 6',
    )).toEqual([1, 4]);
  });

  it('ignores quoted text and comments and resets at statement boundaries', () => {
    expect(compoundOperatorCounts(`
      SELECT 'it''s UNION; ( EXCEPT )' AS "UNION" -- UNION ) ;
      UNION ALL SELECT 2 /* INTERSECT ( ; */;
      SELECT 3 EXCEPT SELECT 4;
    `)).toEqual([1, 1, 0]);
  });
});

describe('account scope migrations stay below the D1 compound SELECT limit', () => {
  it.each(['199_common_var_account_scope.sql', '261_media_account_scope.sql'])(
    '%s has at most four terms per compound SELECT',
    (file) => {
      const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
      expect(stripSqlLiteralsAndComments(sql)).toMatch(/\bSELECT\b/i);
      for (const count of compoundOperatorCounts(sql)) {
        expect(count, file).toBeLessThanOrEqual(3);
      }
    },
  );

  it.each(['199_common_var_account_scope.sql', '261_media_account_scope.sql'])(
    '%s does not create or drop tables',
    (file) => {
      const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
      expect(stripSqlLiteralsAndComments(sql)).not.toMatch(/\b(?:CREATE|DROP)\s+(?:(?:TEMP|TEMPORARY)\s+)?TABLE\b/i);
    },
  );
});
