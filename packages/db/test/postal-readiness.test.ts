import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { getPostalReadiness, searchPostalCodes } from '../src/postal-codes.js';
import { buildImportSql } from '../../../scripts/fetch-jp-postal-data.mjs';

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

describe('郵便番号検索は同じ番号の候補を欠落させない', () => {
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
    // 4520961は66行（公式全量）。20件打ち切りがあると46行欠落する。
    const values = Array.from(
      { length: 66 },
      (_, i) => `('4520961','愛知県','名古屋市千種区','町${i}',NULL,NULL)`,
    ).join(',');
    sqlite.prepare(`INSERT INTO postal_codes VALUES ${values}`).run();
  });

  test('66行を全部返し、totalに全件数を載せる', async () => {
    const found = await searchPostalCodes(db, '4520961', []);
    expect(found.fromDb).toBe(true);
    expect(found.candidates).toHaveLength(66);
    expect(found.total).toBe(66);
  });

  test('表が無い環境は見本へ倒し、totalは見本の件数', async () => {
    const empty = new Database(':memory:');
    const fallback = [
      { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' },
      { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '皇居外苑' },
    ];
    const found = await searchPostalCodes(asD1(empty), '1000001', fallback);
    expect(found.fromDb).toBe(false);
    expect(found.candidates).toHaveLength(2);
    expect(found.total).toBe(2);
  });
});

describe('取込の途中は全国版と名乗らない（sentinel方式）', () => {
  const OFFICIAL_NEW = OFFICIAL;
  const OLD_ROWS = [
    `('1000001','東京都','千代田区','千代田',NULL,NULL)`,
    `('1000001','東京都','千代田区','皇居外苑',NULL,NULL)`,
    `('5300001','大阪府','大阪市北区','梅田',NULL,NULL)`,
  ];
  // 同件数3件。B（梅田）が落ち、C（札幌）が入る。今回データだけが残る。
  const NEW_ROWS = [
    { code: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' },
    { code: '1000001', prefecture: '東京都', city: '千代田区', town: '皇居外苑' },
    { code: '0600000', prefecture: '北海道', city: '札幌市中央区', town: '' },
  ];

  function splitStatements(sql: string): string[] {
    return sql
      .split(/;\n/)
      .map((part) => part
        .split('\n')
        .filter((line) => !line.startsWith('--') && line.trim() !== '')
        .join('\n')
        .trim())
      .filter(Boolean)
      .map((stmt) => `${stmt};`);
  }

  function setupOldFull(sqlite: Database.Database) {
    sqlite.exec(`
      CREATE TABLE postal_codes (
        postal_code TEXT NOT NULL, prefecture TEXT NOT NULL, city TEXT NOT NULL,
        town TEXT NOT NULL DEFAULT '', source_name TEXT, imported_at TEXT,
        PRIMARY KEY (postal_code, prefecture, city, town));
      CREATE TABLE postal_import_manifest (
        id TEXT PRIMARY KEY, source_url TEXT NOT NULL, input_sha256 TEXT NOT NULL,
        input_bytes INTEGER NOT NULL, row_count INTEGER NOT NULL, imported_at TEXT NOT NULL);
    `);
    sqlite.prepare(
      `INSERT INTO postal_import_manifest VALUES ('jp-old', ?, 'oldsha', 10, 3, '2026-10-01T00:00:00+09:00')`,
    ).run(OFFICIAL_NEW);
    sqlite.prepare(`INSERT INTO postal_codes VALUES ${OLD_ROWS.join(',')}`).run();
  }

  test('開始だけ・本体途中・同件数一致でもfalse、完了でtrue・旧コードは残らない', async () => {
    const sqlite = new Database(':memory:');
    setupOldFull(sqlite);
    const db = asD1(sqlite);
    const before = await getPostalReadiness(db);
    expect(before).toMatchObject({ fullDataset: true, complete: true, rowCount: 3 });

    const sql = buildImportSql({
      rows: NEW_ROWS, sourceUrl: OFFICIAL_NEW, inputSha256: 'newsha',
      inputBytes: 10, manifestId: 'jp-new', importedAt: '2026-10-02T00:00:00+09:00',
    });
    const stmts = splitStatements(sql);
    // 開始3文＋本体1文＋末尾1文（3件は1chunk）。
    expect(stmts.length).toBe(5);
    expect(stmts[0]).toBe('DELETE FROM postal_import_manifest;');
    expect(stmts[1]).toBe('DELETE FROM postal_codes;');

    // 開始だけ: 旧全国版は消え、取込中の印だけ。false。
    sqlite.exec(stmts[0]);
    sqlite.exec(stmts[1]);
    sqlite.exec(stmts[2]);
    const started = await getPostalReadiness(db);
    expect(started).toMatchObject({ fullDataset: false, complete: false, rowCount: 0, expectedRows: 0 });

    // 本体途中: 件数は新旧どちらの3件とも一致するが、印が-1のためfalse。
    sqlite.exec(stmts[3]);
    const partial = await getPostalReadiness(db);
    expect(partial.rowCount).toBe(3);
    expect(partial).toMatchObject({ fullDataset: false, complete: false, expectedRows: 0 });

    // 全部完了: true。旧コード（梅田）は残らず、今回データだけ。
    sqlite.exec(stmts[4]);
    const done = await getPostalReadiness(db);
    expect(done).toMatchObject({
      fullDataset: true, complete: true, rowCount: 3, expectedRows: 3, inputSha256: 'newsha',
    });
    const towns = sqlite.prepare('SELECT town FROM postal_codes ORDER BY town').all() as Array<{ town: string }>;
    expect(towns.map((r) => r.town).sort()).toEqual(['', '千代田', '皇居外苑']);
  });
});
