import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMedia,
  getMediaDeleteImpactSnapshot,
  getMediaUsageReferenceStates,
  recordMediaUsage,
} from './media.js';

/*
 * R34: 使用箇所の取得がどの画像でも失敗し、読み直しても直らない。
 * 原因は、表そのものが無い読み口（古い環境に無い機能の表）を例外に
 * していたこと。表が無い読み口は「未確認」に倒し、全体を503にしない。
 */

const packageRoot = join(import.meta.dirname, '..');

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

function insertAccount(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

describe('R34 表が無い読み口は未確認に倒す', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    db = asD1(sqlite);
  });

  async function seedMedia(): Promise<string> {
    const media = await createMedia(db, {
      kind: 'image',
      lineAccountId: 'account-a',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      r2Key: 'media/account-a/a.png',
    });
    return media.id;
  }

  it('使用先の表が無くてもsnapshotは落ちず、参照を未確認に残す', async () => {
    const id = await seedMedia();
    await recordMediaUsage(db, { mediaId: id, refKind: 'webinar', refId: 'w-1' });
    // 古い環境にはウェビナーの表が無い想定。
    sqlite.exec('DROP TABLE webinars');

    const snapshot = await getMediaDeleteImpactSnapshot(db, id, 'account-a', '2026-09-27T10:00:00+09:00');

    expect(snapshot).not.toBeNull();
    expect(snapshot!.impact.usageCount).toBe(1);
    expect(snapshot!.impact.references[0]).toMatchObject({ kind: 'webinar', state: 'unavailable' });
    // 参照自体は落とさないため、削除は止まったまま。
    expect(snapshot!.impact.canDelete).toBe(false);
    expect(snapshot!.impact.verified).toBe(true);
  });

  it('参照モードの読み口も表が無ければ未確認に倒す', async () => {
    const id = await seedMedia();
    await recordMediaUsage(db, { mediaId: id, refKind: 'webinar', refId: 'w-1' });
    sqlite.exec('DROP TABLE webinars');
    const media = (await db.prepare('SELECT * FROM media WHERE id = ?').bind(id).first()) as never;

    const states = await getMediaUsageReferenceStates(db, {
      media,
      usages: [{ media_id: id, ref_kind: 'webinar', ref_id: 'w-1', scanned_at: '2026-09-27T10:00:00+09:00' }],
      versions: [],
      lineAccountId: 'account-a',
    });

    expect(states).toEqual([{ mode: 'unavailable', versionNo: null }]);
  });

  it('使用先が無ければ確かめた未使用（verified）で返す', async () => {
    const id = await seedMedia();

    const snapshot = await getMediaDeleteImpactSnapshot(db, id, 'account-a', '2026-09-27T10:00:00+09:00');

    expect(snapshot!.impact).toMatchObject({ usageCount: 0, verified: true, canDelete: true });
  });
});
