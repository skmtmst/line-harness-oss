import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  advanceWebinarVideoAsset,
  canPurgeWebinarVideoAsset,
  findExpiredWebinarVideoAssets,
  getWebinarSession,
  getWebinarVideoAsset,
  isWebinarMissedInWindow,
  isWebinarVideoReady,
  purgeWebinarVideoAsset,
  releaseWebinarSeat,
  reserveWebinarSeat,
  setWebinarSessionCapacity,
} from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '../migrations');

function setupDb(): { sqlite: Database.Database; db: D1Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE webinars (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE webinar_notification_settings (
      webinar_id TEXT PRIMARY KEY,
      missed_enabled INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO friends VALUES ('friend-1');
    INSERT INTO webinars (id, status) VALUES ('webinar-1', 'draft');
    INSERT INTO webinar_notification_settings (webinar_id, missed_enabled) VALUES ('webinar-1', 1);
  `);
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '478_webinar_video_assets.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '479_webinar_session_capacity.sql'), 'utf8'));
  return { sqlite, db: asD1(sqlite) };
}

describe('478 webinar video assets (N)', () => {
  let db: D1Database;

  beforeEach(() => {
    ({ db } = setupDb());
  });

  test('動画は検査→変換→配信の形→表紙の段を順に進む', async () => {
    expect(await advanceWebinarVideoAsset(db, 'webinar-1', 'uploaded')).not.toBeNull();
    // 飛ばしは進めない
    expect(await advanceWebinarVideoAsset(db, 'webinar-1', 'converting')).toBeNull();
    for (const stage of ['inspecting', 'converting', 'packaging', 'thumbnail', 'ready'] as const) {
      expect(await advanceWebinarVideoAsset(db, 'webinar-1', stage)).toMatchObject({ stage });
    }
    expect(await isWebinarVideoReady(db, 'webinar-1')).toBe(true);
  });

  test('準備が済むまで配信に選べない', async () => {
    expect(await isWebinarVideoReady(db, 'webinar-1')).toBe(false);
    await advanceWebinarVideoAsset(db, 'webinar-1', 'uploaded');
    await advanceWebinarVideoAsset(db, 'webinar-1', 'inspecting');
    expect(await isWebinarVideoReady(db, 'webinar-1')).toBe(false);
  });

  test('失敗はどの段からでも行ける', async () => {
    await advanceWebinarVideoAsset(db, 'webinar-1', 'uploaded');
    await advanceWebinarVideoAsset(db, 'webinar-1', 'inspecting');
    expect(await advanceWebinarVideoAsset(db, 'webinar-1', 'failed', { errorCode: 'virus_found' }))
      .toMatchObject({ stage: 'failed', error_code: 'virus_found' });
    expect(await isWebinarVideoReady(db, 'webinar-1')).toBe(false);
  });

  test('終了から90日を過ぎた動画は消せるが、使っている間は消さない', async () => {
    await advanceWebinarVideoAsset(db, 'webinar-1', 'uploaded');
    const asset = (await getWebinarVideoAsset(db, 'webinar-1'))!;
    // 公開中のウェビナーが参照している間は消さない
    await db.prepare(`UPDATE webinars SET status = 'active', video_asset_id = ? WHERE id = ?`)
      .bind(asset.id, 'webinar-1').run();
    expect(await canPurgeWebinarVideoAsset(db, asset.id)).toBe(false);
    expect(await purgeWebinarVideoAsset(db, asset.id)).toBe(false);
    // 終了後は消せる
    await db.prepare(`UPDATE webinars SET status = 'archived' WHERE id = ?`).bind('webinar-1').run();
    await db.prepare(`UPDATE webinar_video_assets SET expires_at = ? WHERE id = ?`)
      .bind('2026-06-01T00:00:00+09:00', asset.id).run();
    expect(await findExpiredWebinarVideoAssets(db, '2026-09-27T00:00:00+09:00')).toHaveLength(1);
    expect(await purgeWebinarVideoAsset(db, asset.id)).toBe(true);
    expect(await isWebinarVideoReady(db, 'webinar-1')).toBe(false);
  });
});

describe('479 webinar sessions and missed window (N)', () => {
  let db: D1Database;

  beforeEach(() => {
    ({ db } = setupDb());
  });

  test('定員は申込の時に確保し、満員なら断る', async () => {
    await setWebinarSessionCapacity(db, 'webinar-1', 1000, 2);
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('reserved');
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('reserved');
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('full');
    expect(await getWebinarSession(db, 'webinar-1', 1000)).toMatchObject({
      reserved_count: 2, state: 'full',
    });
  });

  test('定員の無い開催回は無制限', async () => {
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('unlimited');
  });

  test('取り消したら席が空く', async () => {
    await setWebinarSessionCapacity(db, 'webinar-1', 1000, 1);
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('reserved');
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('full');
    await releaseWebinarSeat(db, 'webinar-1', 1000);
    expect(await reserveWebinarSeat(db, 'webinar-1', 1000)).toBe('reserved');
  });

  test('見逃し配信は「する」の期限内だけ', async () => {
    const sessionStart = 1_000_000;
    // 開催から7日以内は期限内
    expect(await isWebinarMissedInWindow(db, 'webinar-1', sessionStart, sessionStart + 6 * 86400)).toBe(true);
    // 8日後は期限切れ
    expect(await isWebinarMissedInWindow(db, 'webinar-1', sessionStart, sessionStart + 8 * 86400)).toBe(false);
  });

  test('見逃しを「しない」にしたら期限内でも送らない', async () => {
    await db.prepare(`UPDATE webinar_notification_settings SET missed_enabled = 0 WHERE webinar_id = ?`)
      .bind('webinar-1').run();
    expect(await isWebinarMissedInWindow(db, 'webinar-1', 1_000_000, 1_000_100)).toBe(false);
  });
});
