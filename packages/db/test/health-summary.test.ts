import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getLatestRiskLevels } from '../src/health.js';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

function setup(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE account_health_logs (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      error_code INTEGER,
      error_count INTEGER NOT NULL DEFAULT 0,
      check_period TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    `INSERT INTO account_health_logs
       (id, line_account_id, error_code, error_count, check_period, risk_level, created_at)
     VALUES (?, ?, NULL, 0, '2026-09-08', ?, ?)`,
  );
  // a1 は normal → warning → danger と悪化。最新だけが返る。
  insert.run('log-a1-old', 'a1', 'normal', '2026-09-06T00:00:00+09:00');
  insert.run('log-a1-mid', 'a1', 'warning', '2026-09-07T00:00:00+09:00');
  insert.run('log-a1-new', 'a1', 'danger', '2026-09-08T00:00:00+09:00');
  // a2 は warning のまま。
  insert.run('log-a2-old', 'a2', 'normal', '2026-09-06T00:00:00+09:00');
  insert.run('log-a2-new', 'a2', 'warning', '2026-09-08T00:00:00+09:00');
  // a9 は渡さない範囲外。混ざらないことの確認用。
  insert.run('log-a9-new', 'a9', 'danger', '2026-09-08T00:00:00+09:00');
  return asD1(sqlite);
}

describe('getLatestRiskLevels', () => {
  it('複数アカウントの最新だけを1回で返す', async () => {
    const rows = await getLatestRiskLevels(setup(), ['a1', 'a2']);
    expect(new Map(rows.map((row) => [row.line_account_id, row.risk_level]))).toEqual(
      new Map([
        ['a1', 'danger'],
        ['a2', 'warning'],
      ]),
    );
  });

  it('渡していない範囲外や記録なしは含めない', async () => {
    const rows = await getLatestRiskLevels(setup(), ['a1', 'a3']);
    expect(rows).toEqual([{ line_account_id: 'a1', risk_level: 'danger' }]);
  });

  it('空なら問い合わせず空を返す', async () => {
    await expect(getLatestRiskLevels(setup(), [])).resolves.toEqual([]);
  });
});
