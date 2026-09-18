/*
 * 分析対象者を使う予約・キュー配信の再確認(N-274 / #842)。
 *
 * 対象者は24時間で消える。予約した時点では有効でも、届く時刻には
 * 切れていることがある。送信直前にもう一度確かめ、使えなければ
 * 予約を下書きへ戻す（毎tickの再試行で直らないため）。
 * 途中まで送った配信は、条件のSQL側が期限を確かめるので残りは誰にも
 * 届かず自然に終わる。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）へ実物の processScheduledBroadcasts /
 * processQueuedBroadcasts を当てる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const line = vi.hoisted(() => ({
  pushed: [] as unknown[],
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    async broadcast() { return { requestId: 'request-1' }; }
    async multicast(to: string[], messages: unknown) {
      line.pushed.push({ to, messages });
      return { requestId: 'request-1' };
    }
    async pushMessage(to: string, messages: unknown) {
      line.pushed.push({ to: [to], messages });
      return { requestId: 'request-1' };
    }
  },
}));

const { processScheduledBroadcasts, processQueuedBroadcasts } = await import('./broadcast.js');

function seedAccount(raw: SqliteD1['raw'], id: string): void {
  raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active)
    VALUES (?, ?, ?, ?, 'secret', 1)
  `).run(id, `channel-${id}`, id, `token-${id}`);
}

function seedFriend(raw: SqliteD1['raw'], id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(id, `U-${id}`, `友だち${id}`, accountId);
}

function seedAudience(
  raw: SqliteD1['raw'],
  id: string,
  accountId: string,
  { expiresAt, friendIds = [] }: { expiresAt: string; friendIds?: string[] },
): void {
  const runId = `run-${accountId}`;
  if (!raw.prepare(`SELECT id FROM analytics_cross_runs WHERE id = ?`).get(runId)) {
    raw.prepare(`
      INSERT INTO analytics_cross_runs
        (id, line_account_id, query_json, state, period_from, period_to, time_zone, data_cutoff_at, created_at)
      VALUES (?, ?, '{}', 'available', '2026-09-01', '2026-09-30', 'Asia/Tokyo', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    `).run(runId, accountId);
  }
  raw.prepare(`
    INSERT INTO analytics_result_audiences
      (id, line_account_id, source_kind, source_result_id, selection_key, member_count, expires_at, created_at)
    VALUES (?, ?, 'cross', ?, 'a:b', ?, ?, '2026-10-01T00:00:00.000Z')
  `).run(id, accountId, runId, friendIds.length, expiresAt);
  for (const friendId of friendIds) {
    raw.prepare(
      `INSERT INTO analytics_result_audience_members (audience_id, friend_id) VALUES (?, ?)`,
    ).run(id, friendId);
  }
}

function audienceConditions(audienceId: string): string {
  return JSON.stringify({
    operator: 'AND',
    rules: [
      { type: 'is_following', value: true },
      { type: 'analytics_audience', value: { audienceId } },
    ],
  });
}

function seedScheduledSegment(
  raw: SqliteD1['raw'],
  id: string,
  accountId: string,
  conditions: string,
  scheduledAt = '2026-09-16T00:00:00.000Z',
): void {
  raw.prepare(`
    INSERT INTO broadcasts
      (id, title, message_type, message_content, target_type, status,
       scheduled_at, line_account_id, segment_conditions)
    VALUES (?, '対象者へ配信', 'text', 'こんにちは', 'segment', 'scheduled', ?, ?, ?)
  `).run(id, scheduledAt, accountId, conditions);
}

function seedSendingSegment(
  raw: SqliteD1['raw'],
  id: string,
  accountId: string,
  conditions: string,
  batchOffset = 0,
): void {
  raw.prepare(`
    INSERT INTO broadcasts
      (id, title, message_type, message_content, target_type, status,
       line_account_id, segment_conditions, batch_offset, total_count)
    VALUES (?, '対象者へ配信', 'text', 'こんにちは', 'segment', 'sending', ?, ?, ?, 10)
  `).run(id, accountId, conditions, batchOffset);
}

function broadcastRow(store: SqliteD1, id: string) {
  return store.raw.prepare(
    `SELECT status, scheduled_at, batch_offset, total_count FROM broadcasts WHERE id = ?`,
  ).get(id) as { status: string; scheduled_at: string | null; batch_offset: number; total_count: number };
}

describe('分析対象者の予約・キュー再確認(N-274)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T02:00:00.000Z'));
    line.pushed = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota')) {
        return new Response(JSON.stringify({ type: 'limited', value: 1000 }), { status: 200 });
      }
      if (url.endsWith('/quota/consumption')) {
        return new Response(JSON.stringify({ totalUsage: 0 }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('予約時点で期限切れの対象者は、送信せず下書きへ戻す', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'acc-a');
    seedAudience(store.raw, 'aud-old', 'acc-a', { expiresAt: '2026-09-15T00:00:00.000Z' });
    seedScheduledSegment(store.raw, 'bc-1', 'acc-a', audienceConditions('aud-old'));

    await processScheduledBroadcasts(store.db, {} as never);

    const row = broadcastRow(store, 'bc-1');
    expect(row.status).toBe('draft');
    expect(row.scheduled_at).toBeNull();
    expect(line.pushed).toHaveLength(0);
  });

  it('他アカウントの対象者を指す予約も、送信せず下書きへ戻す', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'acc-a');
    seedAccount(store.raw, 'acc-b');
    seedAudience(store.raw, 'aud-b', 'acc-b', { expiresAt: '2026-09-17T00:00:00.000Z' });
    seedScheduledSegment(store.raw, 'bc-2', 'acc-a', audienceConditions('aud-b'));

    await processScheduledBroadcasts(store.db, {} as never);

    expect(broadcastRow(store, 'bc-2').status).toBe('draft');
    expect(line.pushed).toHaveLength(0);
  });

  it('有効な対象者の予約は、その人数で送り始める', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'acc-a');
    seedFriend(store.raw, 'f-1', 'acc-a');
    seedFriend(store.raw, 'f-2', 'acc-a');
    seedAudience(store.raw, 'aud-live', 'acc-a', {
      expiresAt: '2026-09-17T00:00:00.000Z',
      friendIds: ['f-1', 'f-2'],
    });
    seedScheduledSegment(store.raw, 'bc-3', 'acc-a', audienceConditions('aud-live'));

    await processScheduledBroadcasts(store.db, {} as never);

    const row = broadcastRow(store, 'bc-3');
    expect(row.status).toBe('sending');
    expect(row.total_count).toBe(2);
  });

  it('キュー処理は、まだ誰にも送っていない期限切れの配信を下書きへ戻す', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'acc-a');
    seedAudience(store.raw, 'aud-q', 'acc-a', { expiresAt: '2026-09-15T00:00:00.000Z' });
    seedSendingSegment(store.raw, 'bc-4', 'acc-a', audienceConditions('aud-q'), 0);

    await processQueuedBroadcasts(store.db, {} as never);

    expect(broadcastRow(store, 'bc-4').status).toBe('draft');
    expect(line.pushed).toHaveLength(0);
  });

  it('キュー処理は、有効な対象者なら対象者の友だちだけへ送る', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'acc-a');
    seedFriend(store.raw, 'f-in', 'acc-a');
    seedFriend(store.raw, 'f-out', 'acc-a');
    seedAudience(store.raw, 'aud-send', 'acc-a', {
      expiresAt: '2026-09-17T00:00:00.000Z',
      friendIds: ['f-in'],
    });
    seedSendingSegment(store.raw, 'bc-5', 'acc-a', audienceConditions('aud-send'), 0);

    await processQueuedBroadcasts(store.db, {} as never);

    expect(line.pushed).toHaveLength(1);
    expect((line.pushed[0] as { to: string[] }).to).toEqual(['U-f-in']);
    expect(broadcastRow(store, 'bc-5').status).toBe('sent');
  });
});
