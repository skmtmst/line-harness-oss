import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getMediaUsageScanState,
  recordMediaUsages,
  pruneStaleMediaUsagesBatch,
  saveMediaUsageScanState,
} from '../src/media.js';

function asD1(sqlite: Database.Database, onBatch: (size: number) => void): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = sqlite.prepare(query).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } } as T;
      },
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      onBatch(statements.length);
      return Promise.all(statements.map((statement) => statement.run())) as Promise<T[]>;
    },
  } as unknown as D1Database;
}

describe('メディア使用先の分割走査台帳', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let batchSizes: number[];

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE media (id TEXT PRIMARY KEY);
      CREATE TABLE media_usages (
        media_id TEXT NOT NULL,
        ref_kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        PRIMARY KEY (media_id, ref_kind, ref_id)
      );
    `);
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', 'migrations', '278_media_usage_scan_state.sql'),
      'utf8',
    ));
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', 'migrations', '281_media_usage_prune_index.sql'),
      'utf8',
    ));
    batchSizes = [];
    db = asD1(sqlite, (size) => batchSizes.push(size));
  });

  it('初回状態を作り、次のcronが保存したカーソルから再開できる', async () => {
    await expect(getMediaUsageScanState(db, '2026-09-04T06:00:00.000')).resolves.toEqual({
      sourceIndex: 0,
      lastRefId: '',
      cycleStartedAt: '2026-09-04T06:00:00.000',
    });

    await saveMediaUsageScanState(db, {
      sourceIndex: 2,
      lastRefId: 'page-1000',
      cycleStartedAt: '2026-09-04T06:00:00.000',
    }, '2026-09-04T12:00:00.000');

    await expect(getMediaUsageScanState(db, 'ignored')).resolves.toEqual({
      sourceIndex: 2,
      lastRefId: 'page-1000',
      cycleStartedAt: '2026-09-04T06:00:00.000',
    });
  });

  it('45件を個別更新せず、bind上限内の3文へ分けて1回でbatch実行する', async () => {
    const usages = Array.from({ length: 45 }, (_, index) => ({
      mediaId: `media-${index % 5}`,
      refKind: 'template' as const,
      refId: `template-${index}`,
    }));

    await recordMediaUsages(db, usages, '2026-09-04T06:00:00.000');

    expect(batchSizes).toEqual([3]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM media_usages').get())
      .toEqual({ count: 45 });
    expect(sqlite.prepare('SELECT COUNT(DISTINCT scanned_at) AS count FROM media_usages').get())
      .toEqual({ count: 1 });
  });

  it('古い使用先を指定件数までに限定して整理する', async () => {
    sqlite.prepare('INSERT INTO media (id) VALUES (?)').run('media-1');
    const insert = sqlite.prepare(
      'INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at) VALUES (?, ?, ?, ?)',
    );
    for (let index = 0; index < 12; index += 1) {
      insert.run('media-1', 'template', `template-${index}`, '2026-09-01T00:00:00.000');
    }

    await expect(pruneStaleMediaUsagesBatch(
      db,
      '2026-09-04T00:00:00.000',
      ['media-1'],
      5,
    )).resolves.toBe(5);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM media_usages').get())
      .toEqual({ count: 7 });
    const plan = sqlite.prepare(
      `EXPLAIN QUERY PLAN
       SELECT rowid FROM media_usages
        WHERE scanned_at < ? AND media_id IN (?)
        LIMIT ?`,
    ).all('2026-09-04T00:00:00.000', 'media-1', 5) as Array<{ detail: string }>;
    expect(plan.some((row) => row.detail.includes('idx_media_usages_media_scanned'))).toBe(true);
  });
});
