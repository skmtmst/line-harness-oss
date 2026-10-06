import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { recordWebinarHeartbeat } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { countRecentWebinarViewers } from './webinar-audience.js';
let fixture: ReturnType<typeof createTestD1>;
const now = Math.floor(Date.parse('2026-10-07T00:00:00.000Z') / 1000);
beforeEach(() => {
  fixture = createTestD1();
  vi.useFakeTimers();
  vi.setSystemTime(now * 1000);
});
afterEach(() => { fixture.raw.close(); vi.useRealTimers(); });
function segment(id: string, friend: string, secondsAgo: number, webinar = 'w', session = 100, jst = false) {
  const date = new Date((now - secondsAgo) * 1000);
  const received = jst ? new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, -1) + '+09:00' : date.toISOString();
  fixture.raw.prepare(`INSERT INTO webinar_view_segments
    (id, webinar_id, friend_id, session_start_at, start_seconds, end_seconds, received_at, idempotency_key)
    VALUES (?, ?, ?, ?, 0, 15, ?, ?)`).run(id, webinar, friend, session, received, id);
}
test('同じ人の再送は一人と数え、60秒境界と時差を扱い、古い・未来・別回・別配信は除く', async () => {
  segment('a1', 'a', 0);
  segment('a2', 'a', 30, 'w', 100, true);
  segment('b', 'b', 60, 'w', 100, true);
  segment('old', 'c', 61);
  segment('future', 'd', -1);
  segment('session', 'e', 0, 'w', 101);
  segment('other', 'f', 0, 'other');
  expect(await countRecentWebinarViewers(fixture.db, 'w', 100, now)).toBe(2);
  expect(await countRecentWebinarViewers(fixture.db, 'w', 100, now + 62)).toBe(0);
});
test('正常な再生通信が一人だけあれば1を返す', async () => {
  await recordWebinarHeartbeat(fixture.db, {
    webinarId: 'w', friendId: 'f', sessionStartAt: 100, positionSeconds: 15,
    playerState: 'playing', receivedAtEpoch: now,
  });
  expect(await countRecentWebinarViewers(fixture.db, 'w', 100, now)).toBe(1);
});
test.each(['paused', 'hidden', 'buffering', 'seeking'] as const)('%sの通信だけなら視聴人数を増やさない', async playerState => {
  await recordWebinarHeartbeat(fixture.db, {
    webinarId: 'w', friendId: 'f', sessionStartAt: 100, positionSeconds: 15,
    playerState, receivedAtEpoch: now,
  });
  expect(await countRecentWebinarViewers(fixture.db, 'w', 100, now)).toBe(0);
});
test('異常な再生位置の通信は正常視聴人数へ含めない', async () => {
  fixture.raw.exec(`INSERT INTO webinar_viewers (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds, last_heartbeat_at)
    VALUES ('v', 'w', 'f', 100, '2026-10-06', 0, ${now - 15});`);
  expect(await recordWebinarHeartbeat(fixture.db, {
    webinarId: 'w', friendId: 'f', sessionStartAt: 100, positionSeconds: 9999,
    playerState: 'playing', receivedAtEpoch: now,
  })).toMatchObject({ status: 'rejected' });
  expect(await countRecentWebinarViewers(fixture.db, 'w', 100, now)).toBe(0);
});
