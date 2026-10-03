import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  RETENTION_R2_KEY_COLUMNS,
  RETENTION_TABLES,
  purgeTablesChildFirst,
  tenantScopeCondition,
} from './data-retention-tables.js';

/*
 * ★V6 36-2 退会後の顧客データ削除。
 *
 * 表を1つ足して分類を書き忘れると、その表の顧客データだけが消えずに残る。
 * 設計書を読み直さないと気づけないので、ここで bootstrap.sql と分類表を
 * 突き合わせて落とす。条件式も実際の SQLite に通して、列名の打ち間違いを
 * 本番の削除処理より先に見つける。
 */

const packageRoot = join(import.meta.dirname, '..');

let sqlite: Database.Database;
/** bootstrap.sql に実在する表の名前。 */
let schemaTables: Set<string>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  schemaTables = new Set(
    sqlite
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => row.name),
  );
});

function columnsOf(table: string): Set<string> {
  const rows = sqlite.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((row) => row.name));
}

describe('保存期限の分類表', () => {
  it('bootstrap.sql の表がすべて分類されている', () => {
    const missing = [...schemaTables].filter((name) => !RETENTION_TABLES[name]).sort();
    expect(
      missing,
      `分類されていない表があります。packages/db/src/data-retention-tables.json に ` +
        `purge(顧客データ) / retain(監査・支払・審査) / global(統括に紐づかない) のどれかを足してください: ` +
        missing.join(', '),
    ).toEqual([]);
  });

  it('分類表に、もう無くなった表が残っていない', () => {
    const stale = Object.keys(RETENTION_TABLES)
      .filter((name) => !schemaTables.has(name))
      .sort();
    expect(stale, `bootstrap.sql に無い表が分類表に残っています: ${stale.join(', ')}`).toEqual([]);
  });

  it('紐づけに使う列が実在する', () => {
    const broken: string[] = [];
    for (const [table, entry] of Object.entries(RETENTION_TABLES)) {
      if (!entry.scope) continue;
      if (!columnsOf(table).has(entry.scope.column)) {
        broken.push(`${table}.${entry.scope.column}`);
      }
      if (entry.scope.by === 'parent') {
        const parent = RETENTION_TABLES[entry.scope.parent];
        if (!parent) broken.push(`${table} -> 親 ${entry.scope.parent} が分類表に無い`);
        else if (!parent.scope) broken.push(`${table} -> 親 ${entry.scope.parent} が統括に紐づかない`);
        else if (!columnsOf(entry.scope.parent).has(entry.scope.parentColumn)) {
          broken.push(`${entry.scope.parent}.${entry.scope.parentColumn}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('global の表には紐づけが無く、purge/retain の表には紐づけがある', () => {
    const wrong: string[] = [];
    for (const [table, entry] of Object.entries(RETENTION_TABLES)) {
      if (entry.category === 'global' && entry.scope) wrong.push(`${table}: global なのに紐づけがある`);
      if (entry.category === 'purge' && !entry.scope) wrong.push(`${table}: purge なのに紐づけが無い`);
    }
    expect(wrong).toEqual([]);
  });

  it('監査・支払・審査の表は purge に入っていない', () => {
    // 分類を間違えて消してしまうと取り戻せない。名前で分かる分だけでも止める。
    const mustRetain = [
      'audit_events',
      'billing_events',
      'billing_invoices',
      'stripe_events',
      'platform_audit_logs',
      'login_audit',
      'pii_reveal_logs',
      'tenant_data_purge_audit',
      'nen_photo_review_events',
      'site_consent_days',
    ];
    for (const table of mustRetain) {
      expect(RETENTION_TABLES[table]?.category, `${table} は消してはいけない`).toBe('retain');
    }
  });
});

describe('削除する行を選ぶ条件', () => {
  it('purge の全表で、実際の SQLite が条件式を受け付ける', () => {
    const failures: string[] = [];
    for (const table of purgeTablesChildFirst()) {
      const sql = `SELECT COUNT(*) AS n FROM ${table} WHERE ${tenantScopeCondition(table)}`;
      try {
        // 行は無くてよい。列名と表名が実在することを SQLite 自身に確かめさせる。
        sqlite.prepare(sql).get('tenant-not-found');
      } catch (error) {
        failures.push(`${table}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('統括IDを入れる場所がちょうど1つになる', () => {
    for (const table of purgeTablesChildFirst()) {
      const marks = tenantScopeCondition(table).split('?').length - 1;
      expect(marks, `${table} の条件式`).toBe(1);
    }
  });

  it('子の表が親より先に消される順番で返る', () => {
    const order = purgeTablesChildFirst();
    const position = new Map(order.map((name, index) => [name, index]));
    for (const table of order) {
      const scope = RETENTION_TABLES[table].scope;
      if (scope?.by !== 'parent') continue;
      const parentIndex = position.get(scope.parent);
      // 親が retain / global なら順番の対象外。
      if (parentIndex === undefined) continue;
      expect(position.get(table), `${table} は親 ${scope.parent} より先`).toBeLessThan(parentIndex);
    }
  });
});

describe('画像(R2)の鍵を持つ列', () => {
  it('列が実在し、その表が purge に入っているか retain として除かれている', () => {
    for (const { table, column } of RETENTION_R2_KEY_COLUMNS) {
      expect(schemaTables.has(table), `${table} が bootstrap.sql に無い`).toBe(true);
      expect(columnsOf(table).has(column), `${table}.${column} が無い`).toBe(true);
      expect(RETENTION_TABLES[table]).toBeDefined();
    }
  });

  it('bootstrap.sql にある画像の鍵の列を取りこぼしていない', () => {
    // 新しい表が R2 の鍵を持ったのに一覧へ足し忘れると、行だけ消えて画像が残る。
    const known = new Set(RETENTION_R2_KEY_COLUMNS.map(({ table, column }) => `${table}.${column}`));
    const found: string[] = [];
    for (const table of schemaTables) {
      for (const column of columnsOf(table)) {
        if (!/(^|_)(r2_key|object_key)$/.test(column)) continue;
        const key = `${table}.${column}`;
        if (!known.has(key)) found.push(key);
      }
    }
    expect(
      found.sort(),
      `画像の鍵らしい列が一覧にありません。RETENTION_R2_KEY_COLUMNS へ足すか、消さない理由を確かめてください: ${found.join(', ')}`,
    ).toEqual([]);
  });
});
