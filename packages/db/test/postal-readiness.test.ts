import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { getPostalReadiness } from '../src/postal-codes.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = (bindings: unknown[]) => ({
        async run() {
          const info = sqlite.prepare(query).run(...bindings);
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...bindings) as T[], success: true, meta: {} };
        },
      });
      return { bind: (...bindings: unknown[]) => statement(bindings), ...statement([]) };
    },
  } as unknown as D1Database;
}

const OFFICIAL = 'https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip';

describe('郵便番号readinessは完了記録と突き合わせる', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE postal_codes (
        postal_code TEXT NOT NULL, prefecture TEXT NOT NULL, city TEXT NOT NULL,
        town TEXT NOT NULL DEFAULT '', source_name TEXT, imported_at TEXT,
        PRIMARY KEY (postal_code, prefecture, city, town));
      CREATE TABLE postal_import_manifest (
        id TEXT PRIMARY KEY, source_url TEXT NOT NULL, input_sha256 TEXT NOT NULL,
        input_bytes INTEGER NOT NULL, row_count INTEGER NOT NULL, imported_at TEXT NOT NULL);
    `);
    db = asD1(sqlite);
  });

  test('空と記録なし行は全国と名乗らない', async () => {
    expect(await getPostalReadiness(db)).toMatchObject({ fullDataset: false, complete: false });
    sqlite.prepare(`INSERT INTO postal_codes VALUES ('1000001','東京都','千代田区','千代田',NULL,NULL)`).run();
    const partial = await getPostalReadiness(db);
    expect(partial).toMatchObject({ fullDataset: false, complete: false, rowCount: 1, expectedRows: null });
  });

  test('部分取り込みはfalse', async () => {
    sqlite.prepare(`INSERT INTO postal_import_manifest VALUES ('jp-x', ?, 'sha', 10, 3, '2026-10-02T00:00:00+09:00')`).run(OFFICIAL);
    sqlite.prepare(`INSERT INTO postal_codes VALUES ('1000001','東京都','千代田区','千代田',NULL,NULL)`).run();
    const readiness = await getPostalReadiness(db);
    expect(readiness).toMatchObject({ fullDataset: false, complete: false, rowCount: 1, expectedRows: 3 });
  });

  test('一致した公式取り込みだけtrue', async () => {
    sqlite.prepare(`INSERT INTO postal_import_manifest VALUES ('jp-x', ?, 'sha', 10, 2, '2026-10-02T00:00:00+09:00')`).run(OFFICIAL);
    sqlite.prepare(`INSERT INTO postal_codes VALUES ('1000001','東京都','千代田区','千代田',NULL,NULL),('0600000','北海道','札幌市中央区','',NULL,NULL)`).run();
    const readiness = await getPostalReadiness(db);
    expect(readiness).toMatchObject({
      fullDataset: true, complete: true, limited: false, rowCount: 2, expectedRows: 2, inputSha256: 'sha',
    });
  });

  test('見本由来の一致は限定と名乗る', async () => {
    sqlite.prepare(`INSERT INTO postal_import_manifest VALUES ('fx', 'fixture:sample.csv', 'sha', 10, 1, '2026-10-02T00:00:00+09:00')`).run();
    sqlite.prepare(`INSERT INTO postal_codes VALUES ('1000001','東京都','千代田区','千代田',NULL,NULL)`).run();
    const readiness = await getPostalReadiness(db);
    expect(readiness).toMatchObject({ fullDataset: false, complete: true, limited: true });
  });
});
