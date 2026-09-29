import { describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  isNenQuietHours,
  nenQuietHoursResumeAt,
  processNenDeliveries,
} from './nen-engagement.js';

// v6-21 §8: 深夜に送らない・1アカウントが1回の実行で送りすぎない。

const DAYTIME = new Date('2026-09-25T12:00:00+09:00');
const NIGHT = new Date('2026-09-25T23:00:00+09:00');

function seed(raw: SqliteD1['raw'], accountId: string, friendIds: string[]) {
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES (?, ?, ?, 'tok', 'sec')`).run(accountId, `ch-${accountId}`, accountId);
  for (const friendId of friendIds) {
    raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following)
      VALUES (?, ?, ?, 1)`).run(friendId, `U-${friendId}`, accountId);
  }
  raw.prepare(`INSERT INTO nen_campaign_settings
    (campaign_key, label, category, delay_days, delivery_time,
     is_enabled, title, body_text, created_at, updated_at)
    VALUES ('column', 'コラム', 'column', 0, '10:00', 1, '題名', '本文', '2026-01-01', '2026-01-01')`).run();
}

function seedDueJob(raw: SqliteD1['raw'], id: string, friendId: string, accountId: string) {
  raw.prepare(`INSERT INTO nen_delivery_jobs
    (id, campaign_key, friend_id, line_account_id, source_key, payload,
     campaign_snapshot, scheduled_at, status, attempts, created_at, updated_at)
    VALUES (?, 'column', ?, ?, ?, '{}',
            '{"campaign_key":"column","label":"コラム","category":"column","delay_days":0,"delivery_time":"10:00","is_enabled":1,"title":"題名","body_text":"本文"}',
            '2020-01-01 00:00:00', 'pending', 0, '2026-01-01', '2026-01-01')`)
    .run(id, friendId, accountId, `column:${id}`);
}

function stubDispatch(calls: { count: number }) {
  return async () => {
    calls.count++;
    return new Response('{}', { status: 200 });
  };
}

describe('NEN配信の深夜停止と速さの上限', () => {
  test('21時〜8時（JST）は深夜帯、8時〜21時は昼間', () => {
    expect(isNenQuietHours(new Date('2026-09-25T20:59:59+09:00'))).toBe(false);
    expect(isNenQuietHours(new Date('2026-09-25T21:00:00+09:00'))).toBe(true);
    expect(isNenQuietHours(new Date('2026-09-26T03:00:00+09:00'))).toBe(true);
    expect(isNenQuietHours(new Date('2026-09-26T07:59:59+09:00'))).toBe(true);
    expect(isNenQuietHours(new Date('2026-09-26T08:00:00+09:00'))).toBe(false);
    expect(isNenQuietHours(new Date('2026-09-26T12:00:00+09:00'))).toBe(false);
  });

  test('深夜の再開はその日の朝8時・夜の再開は翌朝8時', () => {
    expect(nenQuietHoursResumeAt(new Date('2026-09-26T03:00:00+09:00')))
      .toBe('2026-09-26T08:00:00+09:00');
    expect(nenQuietHoursResumeAt(new Date('2026-09-25T23:00:00+09:00')))
      .toBe('2026-09-26T08:00:00+09:00');
  });

  test('深夜帯は送らずpendingのまま残す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'acc-1', ['friend-1']);
    seedDueJob(raw, 'job-night', 'friend-1', 'acc-1');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x',
      proxyDispatch: stubDispatch(calls) as never, now: NIGHT,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 1 });
    expect(calls.count).toBe(0);
    expect(raw.prepare(`SELECT status FROM nen_delivery_jobs WHERE id = 'job-night'`).get())
      .toEqual({ status: 'pending' });
  });

  test('昼間は同じ予約を送る', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'acc-1', ['friend-1']);
    seedDueJob(raw, 'job-day', 'friend-1', 'acc-1');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x',
      proxyDispatch: stubDispatch(calls) as never, now: DAYTIME,
    });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0, deferred: 0 });
    expect(calls.count).toBe(1);
  });

  test('1アカウントの1回の上限を超えた分は次回へ回す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'acc-1', ['friend-1', 'friend-2', 'friend-3']);
    seedDueJob(raw, 'job-cap-1', 'friend-1', 'acc-1');
    seedDueJob(raw, 'job-cap-2', 'friend-2', 'acc-1');
    seedDueJob(raw, 'job-cap-3', 'friend-3', 'acc-1');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x',
      proxyDispatch: stubDispatch(calls) as never, now: DAYTIME,
      maxJobsPerAccountPerTick: 2,
    });
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 1 });
    expect(calls.count).toBe(2);
    const left = raw.prepare(`SELECT COUNT(*) AS count FROM nen_delivery_jobs WHERE status = 'pending'`).get();
    expect(left).toEqual({ count: 1 });
  });
});
