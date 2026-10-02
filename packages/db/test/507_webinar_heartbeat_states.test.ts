import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  countWebinarHeartbeatRejects,
  countWebinarStartedViewers,
  getWebinarDropoff,
  getWebinarRetention,
  mergeWebinarWatchedSeconds,
  recordWebinarHeartbeat,
} from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '../migrations');

function setupDb(): { sqlite: Database.Database; db: D1Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE webinars (id TEXT PRIMARY KEY);
    INSERT INTO friends VALUES ('friend-1');
    INSERT INTO friends VALUES ('friend-2');
    INSERT INTO webinars VALUES ('webinar-1');
  `);
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '051_webinars.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '329_webinar_editor_and_view_segments.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '507_webinar_heartbeat_state.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '508_webinar_heartbeat_rejects.sql'), 'utf8'));
  return { sqlite, db: asD1(sqlite) };
}

describe('507 webinar heartbeat states (J #821)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    ({ sqlite, db } = setupDb());
  });

  test('再生中だけ区間を作り、一時停止・非表示・読み込み待ちは数えない', async () => {
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'playing', receivedAtEpoch: 2000,
    })).toEqual({ status: 'recorded' });
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'paused', receivedAtEpoch: 2015,
    })).toEqual({ status: 'not_counted' });
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'hidden', receivedAtEpoch: 2030,
    })).toEqual({ status: 'not_counted' });
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'buffering', receivedAtEpoch: 2045,
    })).toEqual({ status: 'not_counted' });

    const segments = sqlite.prepare('SELECT COUNT(*) AS n FROM webinar_view_segments').get() as { n: number };
    expect(segments.n).toBe(1);
    expect(await countWebinarStartedViewers(db, 'webinar-1')).toBe(0);
  });

  test('位置の移動中は異常にせず位置だけ進める', async () => {
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'playing', receivedAtEpoch: 2000,
    });
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 900, playerState: 'seeking', receivedAtEpoch: 2015,
    })).toEqual({ status: 'moved' });
    // 異常の記録は残らない
    expect(await countWebinarHeartbeatRejects(db, 'webinar-1')).toBe(0);
    const viewer = sqlite.prepare(
      'SELECT last_position_seconds FROM webinar_viewers WHERE friend_id = ?',
    ).get('friend-1') as { last_position_seconds: number };
    expect(viewer.last_position_seconds).toBe(900);
  });

  test('位置の進みが経過時間の2倍を超えたら異常として除外する', async () => {
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 30, playerState: 'playing', receivedAtEpoch: 2000,
    });
    // 15秒しか経っていないのに300秒進んだ
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 330, playerState: 'playing', receivedAtEpoch: 2015,
    })).toEqual({ status: 'rejected', reason: 'position_jump' });
    expect(await countWebinarHeartbeatRejects(db, 'webinar-1')).toBe(1);
    // 異常な位置を基準にしない
    const viewer = sqlite.prepare(
      'SELECT last_position_seconds FROM webinar_viewers WHERE friend_id = ?',
    ).get('friend-1') as { last_position_seconds: number };
    expect(viewer.last_position_seconds).toBe(30);
  });

  test('速度再生は速度ぶんだけ上限を広げる', async () => {
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 30, playerState: 'playing', playbackRate: 2, receivedAtEpoch: 2000,
    });
    // 2倍速で15秒経過なら30秒進むのは正常
    expect(await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 60, playerState: 'playing', playbackRate: 2, receivedAtEpoch: 2015,
    })).toEqual({ status: 'recorded' });
    expect(await countWebinarHeartbeatRejects(db, 'webinar-1')).toBe(0);
  });

  test('視聴開始は有効な区間の合計30秒以上', async () => {
    // friend-1: 15秒窓×2 = 30秒 → 開始
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'playing', receivedAtEpoch: 2000,
    });
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 30, playerState: 'playing', receivedAtEpoch: 2015,
    });
    // friend-2: 15秒だけ → 未開始
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-2', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'playing', receivedAtEpoch: 2000,
    });
    expect(await countWebinarStartedViewers(db, 'webinar-1')).toBe(1);
  });

  test('離脱は最後の有効な区間の終わりで見る（報告位置で決めつけない）', async () => {
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
      positionSeconds: 750, playerState: 'playing', receivedAtEpoch: 2000,
    });
    // 報告位置だけ進めても区間が無ければ離脱位置は動かない
    sqlite.prepare(
      'UPDATE webinar_viewers SET last_position_seconds = 1500 WHERE friend_id = ?',
    ).run('friend-1');
    expect(await getWebinarDropoff(db, 'webinar-1')).toEqual([
      { bucket_start: 720, viewers: 1 },
    ]);
  });

  test('区間が無い人は離脱に数えない', async () => {
    sqlite.prepare(
      `INSERT INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES ('v1', 'webinar-1', 'friend-1', 1000, '2026-09-27T00:00:00+09:00', 100)`,
    ).run();
    expect(await getWebinarDropoff(db, 'webinar-1')).toEqual([]);
  });

  test('維持率の線は区間が被る人の数と開始人数を返す', async () => {
    for (const position of [15, 30, 45, 60]) {
      await recordWebinarHeartbeat(db, {
        webinarId: 'webinar-1', friendId: 'friend-1', sessionStartAt: 1000,
        positionSeconds: position, playerState: 'playing', receivedAtEpoch: 2000 + position,
      });
    }
    await recordWebinarHeartbeat(db, {
      webinarId: 'webinar-1', friendId: 'friend-2', sessionStartAt: 1000,
      positionSeconds: 15, playerState: 'playing', receivedAtEpoch: 2000,
    });
    const retention = await getWebinarRetention(db, 'webinar-1');
    expect(retention.bucketSeconds).toBe(60);
    expect(retention.started).toBe(1);
    expect(retention.points[0]).toEqual({ at_seconds: 0, viewers: 2 });
  });
});

describe('mergeWebinarWatchedSeconds', () => {
  test('重なる区間を二重に足さない', () => {
    expect(mergeWebinarWatchedSeconds([
      { start_seconds: 0, end_seconds: 15 },
      { start_seconds: 10, end_seconds: 25 },
      { start_seconds: 40, end_seconds: 50 },
    ])).toBe(35);
  });

  test('空と無効な区間は0', () => {
    expect(mergeWebinarWatchedSeconds([])).toBe(0);
    expect(mergeWebinarWatchedSeconds([{ start_seconds: 10, end_seconds: 10 }])).toBe(0);
  });
});
