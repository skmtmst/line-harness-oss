/*
 * 分析で作った一時対象者を配信へ渡す検証(N-274 / #842)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の broadcasts ルートを当てる。
 * 対象者は24時間で消えるため、保存・送信直前のたびに所属と期限を確かめ直す。
 *   - 有効な対象者は segment 配信として作れる
 *   - 不存在・他アカウントは404、期限切れは410
 *   - 保存済みの対象者が期限切れでも、下書きの保存し直し・送信開始で拒否
 *   - 0人の対象者は作れる（届く相手がいないだけ）
 * 送信のキュー投入は止める（LINEへ出さない）。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

vi.mock('../services/broadcast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/broadcast.js')>();
  return {
    ...actual,
    processQueuedBroadcasts: vi.fn().mockResolvedValue(undefined),
    processBroadcastSend: vi.fn().mockResolvedValue(undefined),
  };
});

const { broadcasts } = await import('./broadcasts.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', broadcasts);
  return instance;
}

const HOUR_MS = 60 * 60 * 1000;

function seed(): void {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['acc-1', 'tenant-1'], ['acc-3', 'tenant-2']] as const) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
}

function seedAudience(
  id: string,
  accountId: string,
  { expiresInMs = 23 * HOUR_MS, memberCount = 3 }: { expiresInMs?: number; memberCount?: number } = {},
): void {
  // トリガーが source_result_id の実在を要求するので、各アカウントへ run を1本立てる。
  const runId = `run-${accountId}`;
  const existing = sqlite.raw.prepare(
    `SELECT id FROM analytics_cross_runs WHERE id = ?`,
  ).get(runId);
  if (!existing) {
    sqlite.raw.prepare(
      `INSERT INTO analytics_cross_runs
         (id, line_account_id, query_json, state, period_from, period_to, time_zone, data_cutoff_at, created_at)
       VALUES (?, ?, '{}', 'available', '2026-09-01', '2026-09-30', 'Asia/Tokyo', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    ).run(runId, accountId);
  }
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  sqlite.raw.prepare(
    `INSERT INTO analytics_result_audiences
       (id, line_account_id, source_kind, source_result_id, selection_key, member_count, expires_at, created_at)
     VALUES (?, ?, 'cross', ?, 'a:b', ?, ?, '2026-10-01T00:00:00.000Z')`,
  ).run(id, accountId, runId, memberCount, expiresAt);
}

function audienceCondition(audienceId: string) {
  return {
    operator: 'AND',
    rules: [{ type: 'is_following', value: true }, { type: 'analytics_audience', value: { audienceId } }],
  };
}

const SEGMENT_BODY = {
  title: '対象者へ配信', messageType: 'text', messageContent: 'こんにちは',
  targetType: 'segment', lineAccountId: 'acc-1',
};

function postCreate(body: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request('/api/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putUpdate(id: string, body: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/broadcasts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postSend(id: string, staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/broadcasts/${id}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Confirm-Irreversible': 'broadcast-send' },
    body: JSON.stringify({}),
  });
}

function postSendSegment(id: string, conditions: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/broadcasts/${id}/send-segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Confirm-Irreversible': 'broadcast-send' },
    body: JSON.stringify({ conditions }),
  });
}

function seedSegmentBroadcast(id: string, accountId: string, conditions: unknown, status = 'draft'): void {
  sqlite.raw.prepare(
    `INSERT INTO broadcasts
       (id, title, message_type, message_content, target_type, status, line_account_id, segment_conditions)
     VALUES (?, 'お知らせ', 'text', 'こんにちは', 'segment', ?, ?, ?)`,
  ).run(id, status, accountId, JSON.stringify(conditions));
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
  seed();
});

describe('分析対象者を配信へ渡す(N-274)', () => {
  test('有効な対象者は segment 配信として作れる', async () => {
    seedAudience('aud-ok', 'acc-1');
    const res = await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-ok') });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    const stored = sqlite.raw.prepare(
      `SELECT segment_conditions FROM broadcasts WHERE id = ?`,
    ).get(body.data.id) as { segment_conditions: string };
    expect(stored.segment_conditions).toContain('aud-ok');
  });

  test('0人の対象者でも作れる（届く相手がいないだけ）', async () => {
    seedAudience('aud-zero', 'acc-1', { memberCount: 0 });
    const res = await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-zero') });
    expect(res.status).toBe(201);
  });

  test('不存在の対象者は404で拒否する', async () => {
    const res = await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-none') });
    expect(res.status).toBe(404);
  });

  test('他アカウントの対象者は404で拒否する', async () => {
    seedAudience('aud-other', 'acc-3');
    const res = await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-other') });
    expect(res.status).toBe(404);
  });

  test('期限切れの対象者は410で拒否する', async () => {
    seedAudience('aud-expired', 'acc-1', { expiresInMs: -1 });
    const res = await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-expired') });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('24時間');
  });

  test('期限境界の直前は通り、過ぎると拒否される', async () => {
    seedAudience('aud-edge-ok', 'acc-1', { expiresInMs: 60_000 });
    expect((await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-edge-ok') })).status).toBe(201);
    seedAudience('aud-edge-ng', 'acc-1', { expiresInMs: -1 });
    expect((await postCreate({ ...SEGMENT_BODY, segmentConditions: audienceCondition('aud-edge-ng') })).status).toBe(410);
  });

  test('audienceIdの空欄は壊れた条件として拒否する', async () => {
    const res = await postCreate({
      ...SEGMENT_BODY,
      segmentConditions: { operator: 'AND', rules: [{ type: 'analytics_audience', value: { audienceId: '' } }] },
    });
    expect(res.status).toBe(400);
  });

  test('保存し直しでも期限切れの対象者を拒否する（条件を変えなくても再確認）', async () => {
    seedAudience('aud-later', 'acc-1');
    seedSegmentBroadcast('bc-aud', 'acc-1', audienceCondition('aud-later'));
    // 作ったあとで対象者が期限切れになった状況
    sqlite.raw.prepare(
      `UPDATE analytics_result_audiences SET expires_at = ? WHERE id = 'aud-later'`,
    ).run(new Date(Date.now() - 1).toISOString());
    const res = await putUpdate('bc-aud', { title: '題名の更新', expectedVersion: 1 });
    expect(res.status).toBe(410);
  });

  test('送信開始でも期限切れの対象者を拒否しキューへ載せない', async () => {
    seedAudience('aud-send', 'acc-1', { expiresInMs: -1 });
    seedSegmentBroadcast('bc-send', 'acc-1', audienceCondition('aud-send'));
    const res = await postSend('bc-send');
    expect(res.status).toBe(410);
    const row = sqlite.raw.prepare(`SELECT status FROM broadcasts WHERE id = 'bc-send'`).get() as { status: string };
    expect(row.status).toBe('draft');
  });

  test('送信の二度押しは2回目を409で止める', async () => {
    seedAudience('aud-dbl', 'acc-1');
    seedSegmentBroadcast('bc-dbl', 'acc-1', audienceCondition('aud-dbl'));
    const first = await postSend('bc-dbl');
    expect(first.status).toBe(202);
    const second = await postSend('bc-dbl');
    expect(second.status).toBe(409);
    const row = sqlite.raw.prepare(`SELECT status FROM broadcasts WHERE id = 'bc-dbl'`).get() as { status: string };
    expect(row.status).toBe('sending');
  });

  test('send-segmentの条件でも所属・期限を確かめる', async () => {
    seedAudience('aud-seg', 'acc-1', { expiresInMs: -1 });
    sqlite.raw.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
       VALUES ('bc-seg', 'お知らせ', 'text', 'こんにちは', 'segment', 'draft', 'acc-1')`,
    ).run();
    const res = await postSendSegment('bc-seg', audienceCondition('aud-seg'));
    expect(res.status).toBe(410);
  });
});
