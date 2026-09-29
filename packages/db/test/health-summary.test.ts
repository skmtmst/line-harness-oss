import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getLatestRiskLevel, getLatestRiskLevels } from '../src/health.js';

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

/** 同じ時刻のログが2件ある台。どちらが返るかが決まっているかを見る。 */
function setupTied(): D1Database {
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
  // 先に normal、あとから danger。時刻は同じ。id の大きい方(=あとの記録)を採る。
  insert.run('log-t1-a', 't1', 'normal', '2026-09-08T00:00:00+09:00');
  insert.run('log-t1-b', 't1', 'danger', '2026-09-08T00:00:00+09:00');
  // 古い時刻の記録は関係ない。
  insert.run('log-t1-old', 't1', 'warning', '2026-09-01T00:00:00+09:00');
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

  /**
   * 同じ時刻のログが並んだときの取り出し。
   *
   * `GROUP BY` に対して裸の `risk_level` を並べる書き方だと、SQLite は
   * 通してしまうがどちらの値が返るかは決まらない。危険と正常が同時刻で
   * 並ぶと、サイドバーの警告が出たり出なかったりする(#630)。
   */
  it('同じ時刻のログが並んでも、返す値が1つに決まる', async () => {
    const db = setupTied();
    const first = await getLatestRiskLevels(db, ['t1']);
    expect(first).toEqual([{ line_account_id: 't1', risk_level: 'danger' }]);

    // 何度呼んでも、行の並びを変えても同じ値。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const again = await getLatestRiskLevels(setupTied(), ['t1']);
      expect(again).toEqual(first);
    }
  });

  it('1件取りの getLatestRiskLevel と同じ値になる', async () => {
    const rows = await getLatestRiskLevels(setupTied(), ['t1']);
    const single = await getLatestRiskLevel(setupTied(), 't1');
    expect(rows[0]?.risk_level).toBe(single);
  });
});
