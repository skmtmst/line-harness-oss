import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  attemptPhotoRewardForPhoto,
  deliverPhotoReward,
  photoRewardDisplayState,
  processDuePhotoRewards,
  PHOTO_REWARD_MAX_ATTEMPTS,
  type PhotoRewardOutboxRow,
} from './photo-reward-sync.js';

const NOW = '2026-09-21T00:00:00.000+09:00';
const CLIENT = { baseUrl: 'https://ec.example', secret: 's'.repeat(40) };

function insertAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, line_basic_id)
     VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
  ).run(id, `channel-${id}`, id, `@${id}`);
}

function insertPhoto(raw: Database.Database, id: string, friendId = 'friend-a'): void {
  raw.prepare(
    `INSERT INTO nen_pet_profiles
      (id, friend_id, name, animal_type, created_at, updated_at)
     VALUES ('pet-${id}', ?, 'pet', 'dog', ?, ?)`,
  ).run(friendId, NOW, NOW);
  raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, review_image_url, content_type,
       caption, status, created_at, updated_at, line_account_id)
     VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', '', 'adopted', ?, ?, 'account-a')`,
  ).run(id, friendId, `pet-${id}`, `photos/${id}.jpg`, `https://img/${id}.jpg`,
    `https://img/${id}-r.jpg`, NOW, NOW);
}

function insertReward(
  raw: Database.Database,
  input: { photoId: string; status?: string; attemptCount?: number; lastError?: string | null; nextAttemptAt?: string | null; updatedAt?: string; customerId?: string },
): string {
  const id = `reward-${input.photoId}`;
  raw.prepare(
    `INSERT INTO nen_photo_reward_outbox
      (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
       policy_version, points, status, attempt_count, last_error, next_attempt_at,
       created_at, updated_at)
     VALUES (?, ?, 'account-a', 'friend-a', ?, ?, 'legacy-5', 5, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.photoId, input.customerId ?? '12345', `nen-photo:${input.photoId}`,
    input.status ?? 'pending', input.attemptCount ?? 0, input.lastError ?? null,
    input.nextAttemptAt === undefined ? NOW : input.nextAttemptAt,
    input.updatedAt ?? NOW, input.updatedAt ?? NOW,
  );
  return id;
}

function rewardRow(raw: Database.Database, id: string): PhotoRewardOutboxRow {
  return raw.prepare(`SELECT * FROM nen_photo_reward_outbox WHERE id = ?`).get(id) as PhotoRewardOutboxRow;
}

function ecResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('photoRewardDisplayState', () => {
  const now = new Date('2026-09-22T12:00:00+09:00');
  it('生のstatusを運用向けの派生状態へ分ける', () => {
    expect(photoRewardDisplayState({ status: 'synced', last_error: null, updated_at: NOW }, now)).toBe('synced');
    expect(photoRewardDisplayState({ status: 'pending', last_error: null, updated_at: '2026-09-22T11:00:00+09:00' }, now)).toBe('pending');
    // 24時間超の pending/processing は「要対応」。
    expect(photoRewardDisplayState({ status: 'pending', last_error: null, updated_at: '2026-09-20T11:00:00+09:00' }, now)).toBe('stale');
    expect(photoRewardDisplayState({ status: 'processing', last_error: null, updated_at: '2026-09-20T11:00:00+09:00' }, now)).toBe('stale');
    expect(photoRewardDisplayState({ status: 'failed', last_error: 'ec_unavailable', updated_at: NOW }, now)).toBe('failed_retryable');
    expect(photoRewardDisplayState({ status: 'failed', last_error: 'customer_unlinked', updated_at: NOW }, now)).toBe('failed_permanent');
    expect(photoRewardDisplayState({ status: 'failed', last_error: 'attempts_exhausted', updated_at: NOW }, now)).toBe('failed_permanent');
  });
});

describe('attemptPhotoRewardForPhoto / deliverPhotoReward', () => {
  let testDb: SqliteD1;
  const now = new Date('2026-09-22T12:00:00+09:00');

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
    insertPhoto(testDb.raw, 'photo-1');
  });
  afterEach(() => { vi.unstubAllGlobals(); testDb.raw.close(); });

  it('outbox行がない写真は no_reward で何もしない', async () => {
    const fetcher = vi.fn();
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now, fetcher: fetcher as never },
    );
    expect(attempt.kind).toBe('no_reward');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('synced済みの行は再送しない（二重付与防止）', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1', status: 'synced' });
    const fetcher = vi.fn();
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now, fetcher: fetcher as never },
    );
    expect(attempt.kind).toBe('already_synced');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('pending行をECへ届けて synced にする（awardKeyとHMAC署名つき）', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1' });
    const fetcher = vi.fn(async () => ecResponse({ success: true, awardedPoints: 5, pointBalance: 125 }));
    vi.stubGlobal('fetch', fetcher);
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    expect(attempt.kind).toBe('delivered');
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'synced') throw new Error('expected synced');
    expect(attempt.outcome.duplicate).toBe(false);
    expect(attempt.state).toBe('synced');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ec.example/line-harness/photo-points');
    expect(String((init.headers as Record<string, string>)['X-Nen-Signature'])).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(String(init.body))).toEqual({ customerId: 12345, points: 5, awardKey: 'nen-photo:photo-1' });
    const row = rewardRow(testDb.raw, 'reward-photo-1');
    expect(row.status).toBe('synced');
    expect(row.attempt_count).toBe(1);
    expect(row.synced_at).not.toBeNull();
  });

  it('EC側 duplicate:true は照合収束——DBを synced に合わせる', async () => {
    // EC成功・管理DB失敗の食い違い。同じ awardKey で再度届けると
    // ECは冪等に duplicate を返し、こちらは synced に収束する。
    insertReward(testDb.raw, { photoId: 'photo-1' });
    vi.stubGlobal('fetch', vi.fn(async () => ecResponse({ success: true, duplicate: true, pointBalance: 125 })));
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'synced') throw new Error('expected synced');
    expect(attempt.outcome.duplicate).toBe(true);
    expect(rewardRow(testDb.raw, 'reward-photo-1').status).toBe('synced');
  });

  it('EC 404（会員連携なし）は failed_permanent で次回時刻を持たない', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1' });
    vi.stubGlobal('fetch', vi.fn(async () => ecResponse({ error: 'Linked customer not found' }, 404)));
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'permanent') throw new Error('expected permanent');
    expect(attempt.outcome.reason).toBe('customer_unlinked');
    expect(attempt.state).toBe('failed_permanent');
    const row = rewardRow(testDb.raw, 'reward-photo-1');
    expect(row.status).toBe('failed');
    expect(row.next_attempt_at).toBeNull();
  });

  it('EC 409（日次上限）は翌日に延期する再試行可失敗', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1' });
    vi.stubGlobal('fetch', vi.fn(async () => ecResponse({ error: 'Daily award limit reached' }, 409)));
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'retry_later') throw new Error('expected retry_later');
    expect(attempt.outcome.reason).toBe('daily_limit');
    const row = rewardRow(testDb.raw, 'reward-photo-1');
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('daily_limit');
    // 約24時間後に延期されている。
    const next = Date.parse(String(row.next_attempt_at));
    expect(next - now.getTime()).toBeGreaterThan(23 * 3600_000);
    expect(next - now.getTime()).toBeLessThan(25 * 3600_000);
  });

  it('通信失敗は再試行可失敗（ec_unavailable）でバックオフする', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'retry_later') throw new Error('expected retry_later');
    expect(attempt.outcome.reason).toBe('ec_unavailable');
    expect(rewardRow(testDb.raw, 'reward-photo-1').last_error).toBe('ec_unavailable');
  });

  it('試行回数の上限を超えたら attempts_exhausted で恒久失敗にする', async () => {
    insertReward(testDb.raw, { photoId: 'photo-1', attemptCount: PHOTO_REWARD_MAX_ATTEMPTS - 1 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const attempt = await attemptPhotoRewardForPhoto(
      testDb.db, { photoId: 'photo-1', lineAccountId: 'account-a' }, CLIENT, { now },
    );
    if (attempt.kind !== 'delivered' || attempt.outcome.kind !== 'permanent') throw new Error('expected permanent');
    expect(attempt.outcome.reason).toBe('attempts_exhausted');
    expect(rewardRow(testDb.raw, 'reward-photo-1').status).toBe('failed');
  });

  it('処理中の行は並行して取らない（busy）', async () => {
    // リース内（10分未満）の processing は force でも取れない。
    const fresh = '2026-09-22T11:59:00.000+09:00';
    const id = insertReward(testDb.raw, { photoId: 'photo-1', status: 'processing', updatedAt: fresh });
    const row = rewardRow(testDb.raw, id);
    const fetcher = vi.fn();
    const outcome = await deliverPhotoReward(testDb.db, row, CLIENT, { now, force: true, fetcher: fetcher as never });
    expect(outcome).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('リース切れの processing は回収して届け直す', async () => {
    // 10分超古い processing = 前の実行が途中で死んだ形。
    const stale = '2026-09-21T00:00:00.000+09:00';
    const id = insertReward(testDb.raw, { photoId: 'photo-1', status: 'processing', updatedAt: stale });
    const row = rewardRow(testDb.raw, id);
    vi.stubGlobal('fetch', vi.fn(async () => ecResponse({ success: true })));
    const outcome = await deliverPhotoReward(testDb.db, row, CLIENT, { now, force: true });
    expect(outcome?.kind).toBe('synced');
  });
});

describe('processDuePhotoRewards', () => {
  let testDb: SqliteD1;
  const now = new Date('2026-09-22T12:00:00+09:00');

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
  });
  afterEach(() => { vi.unstubAllGlobals(); testDb.raw.close(); });

  it('期限の来た行だけ届け、未来時刻の行は触らない', async () => {
    insertPhoto(testDb.raw, 'due');
    insertPhoto(testDb.raw, 'future');
    insertPhoto(testDb.raw, 'done');
    insertReward(testDb.raw, { photoId: 'due', nextAttemptAt: '2026-09-21T00:00:00.000+09:00' });
    insertReward(testDb.raw, { photoId: 'future', status: 'failed', lastError: 'ec_unavailable', nextAttemptAt: '2026-09-23T00:00:00.000+09:00' });
    insertReward(testDb.raw, { photoId: 'done', status: 'synced' });
    vi.stubGlobal('fetch', vi.fn(async () => ecResponse({ success: true })));
    const result = await processDuePhotoRewards(testDb.db, CLIENT, { now });
    expect(result.synced).toBe(1);
    expect(rewardRow(testDb.raw, 'reward-due').status).toBe('synced');
    // 未来時刻の失敗行はそのまま。
    expect(rewardRow(testDb.raw, 'reward-future').status).toBe('failed');
    expect(rewardRow(testDb.raw, 'reward-future').attempt_count).toBe(0);
  });

  it('EC接続が未設定なら何もしない（行は要対応として残る）', async () => {
    insertPhoto(testDb.raw, 'stuck');
    insertReward(testDb.raw, { photoId: 'stuck' });
    const fetcher = vi.fn();
    const result = await processDuePhotoRewards(testDb.db, undefined, { now, fetcher: fetcher as never });
    expect(result).toEqual({ claimed: 0, synced: 0, failed: 0, skipped: 0 });
    expect(rewardRow(testDb.raw, 'reward-stuck').status).toBe('pending');
  });
});
