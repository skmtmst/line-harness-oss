/*
 * IDEA-10: ウェビナー参加者の分類フィルタとライブ／録画の区別。
 *
 * 実SQLite（bootstrap.sql を流した better-sqlite3）に実物の webinars
 * ルートを当てて確認する。分類ルールはサーバー側だけが持ち、
 * 応答には根拠（完了閾値・計測可否）も載る。
 *
 * - 未参加 = 申込はあるが入場記録が無い（視聴データが無いことを未視聴と断定しない）
 * - 途中離脱 = 入場したが最大視聴が完了閾値（動画の90%）未満
 * - 完了 = 最大視聴が閾値以上
 * - 計測外 = delivery_kind='external' で個人の視聴を取得できない
 * - ライブ／録画 = 入場時刻が開催時間内か終了後かで区別する
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const ACC = 'acc-a';
const KEY_OWNER = 'key-owner-aaa';
const WEBINAR = 'webinar-1';
const EXTERNAL_WEBINAR = 'webinar-ext';
// 動画1800秒 → 完了閾値は1620秒。
const DURATION = 1800;
const SESSION_START = 1_790_000_000;

const F_REG_ONLY = 'f-reg-only';
const F_DROP = 'f-drop';
const F_DONE = 'f-done';
const F_REPLAY = 'f-replay';
const F_NOREG = 'f-noreg';
const F_EXT = 'f-ext';

function iso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

function seed(sqlite: SqliteD1['raw']) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, 'channel-a', 'アカウントA', 'token', 'secret', 'tenant-1')`,
  ).run(ACC);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER);
  for (const id of [WEBINAR, EXTERNAL_WEBINAR]) {
    sqlite.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, '[]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(id, ACC, `ウェビナー${id}`, `slug-${id}`, DURATION);
  }
  // 外部動画のウェビナーは個人の視聴区間を取得できない。
  sqlite.prepare(
    `INSERT INTO webinar_editor_settings (webinar_id, delivery_kind, created_at, updated_at)
     VALUES (?, 'external', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(EXTERNAL_WEBINAR);

  for (const id of [F_REG_ONLY, F_DROP, F_DONE, F_REPLAY, F_NOREG, F_EXT]) {
    insertFriend(sqlite, id, { line_account_id: ACC });
  }
  const reg = sqlite.prepare(
    `INSERT INTO webinar_registrations (id, webinar_id, friend_id, session_start_at, created_at, status)
     VALUES (?, ?, ?, ?, '2026-09-09T00:00:00.000Z', 'active')`,
  );
  const viewer = sqlite.prepare(
    `INSERT INTO webinar_viewers (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // 申込だけして入場していない人 → 未参加
  reg.run('reg-1', WEBINAR, F_REG_ONLY, SESSION_START);
  // 開催時間内に入場し300秒で止まった人 → 途中離脱・ライブ
  reg.run('reg-2', WEBINAR, F_DROP, SESSION_START);
  viewer.run('wv-1', WEBINAR, F_DROP, SESSION_START, iso(SESSION_START + 60), 300);
  // 開催時間内に入場し1700秒（≧1620）見た人 → 完了・ライブ
  reg.run('reg-3', WEBINAR, F_DONE, SESSION_START);
  viewer.run('wv-2', WEBINAR, F_DONE, SESSION_START, iso(SESSION_START + 30), 1700);
  // 終了後に専用リンクで入場した人 → 途中離脱・録画
  reg.run('reg-4', WEBINAR, F_REPLAY, SESSION_START);
  viewer.run('wv-3', WEBINAR, F_REPLAY, SESSION_START, iso(SESSION_START + DURATION + 600), 500);
  // 申込なしで入場した人 → 途中離脱・ライブ、申込フラグは偽
  viewer.run('wv-4', WEBINAR, F_NOREG, SESSION_START, iso(SESSION_START + 120), 100);
  // 外部動画ウェビナーの申込者。視聴記録があっても計測外。
  reg.run('reg-5', EXTERNAL_WEBINAR, F_EXT, SESSION_START);
  viewer.run('wv-5', EXTERNAL_WEBINAR, F_EXT, SESSION_START, iso(SESSION_START + 60), 300);
}

let sqlite: SqliteD1;
let webinarRoutes: Awaited<typeof import('./webinars.js')>['webinarRoutes'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', webinarRoutes);
  return instance;
}

const env = () => ({ DB: sqlite.db }) as unknown as Env['Bindings'];

function get(path: string, apiKey: string = KEY_OWNER) {
  return app().request(path, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env());
}

type Item = {
  friendId: string;
  classification: string;
  liveSessions: number;
  replaySessions: number;
  lastJoinKind: 'live' | 'replay' | null;
  registered: boolean;
};

async function list(path: string) {
  const res = await get(path);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    data: {
      items: Item[];
      measurement: { state: string; reason: string | null };
      rule: { completionThresholdSeconds: number; durationSeconds: number };
    };
  };
}

beforeEach(async () => {
  sqlite = createTestD1();
  seed(sqlite.raw);
  ({ webinarRoutes } = await import('./webinars.js'));
});

describe('ウェビナー参加者の分類フィルタ (IDEA-10)', () => {
  test('分類・ライブ/録画・根拠を各行と応答へ載せる', async () => {
    const body = await list(`/api/webinars/${WEBINAR}/participants`);
    expect(body.data.rule.completionThresholdSeconds).toBe(1620);
    expect(body.data.measurement.state).toBe('available');

    const byId = new Map(body.data.items.map((item) => [item.friendId, item]));
    expect(byId.get(F_REG_ONLY)).toMatchObject({
      classification: 'unviewed', liveSessions: 0, replaySessions: 0, lastJoinKind: null, registered: true,
    });
    expect(byId.get(F_DROP)).toMatchObject({
      classification: 'dropped_off', liveSessions: 1, replaySessions: 0, lastJoinKind: 'live',
    });
    expect(byId.get(F_DONE)).toMatchObject({
      classification: 'completed', liveSessions: 1, replaySessions: 0, lastJoinKind: 'live',
    });
    expect(byId.get(F_REPLAY)).toMatchObject({
      classification: 'dropped_off', liveSessions: 0, replaySessions: 1, lastJoinKind: 'replay',
    });
    expect(byId.get(F_NOREG)).toMatchObject({
      classification: 'dropped_off', registered: false,
    });
  });

  test('filter=unviewed は申込のみ・入場記録なしの人だけを返す', async () => {
    const body = await list(`/api/webinars/${WEBINAR}/participants?filter=unviewed`);
    expect(body.data.items.map((item) => item.friendId)).toEqual([F_REG_ONLY]);
  });

  test('filter=dropped_off は入場したが未完了の人だけを返す', async () => {
    const body = await list(`/api/webinars/${WEBINAR}/participants?filter=dropped_off`);
    expect(new Set(body.data.items.map((item) => item.friendId)))
      .toEqual(new Set([F_DROP, F_REPLAY, F_NOREG]));
  });

  test('filter=completed は閾値以上の人だけを返す', async () => {
    const body = await list(`/api/webinars/${WEBINAR}/participants?filter=completed`);
    expect(body.data.items.map((item) => item.friendId)).toEqual([F_DONE]);
  });

  test('未知のfilterは 400', async () => {
    const res = await get(`/api/webinars/${WEBINAR}/participants?filter=nonsense`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ success: false, error: 'invalid_filter' });
  });

  test('外部動画は全員が計測外。視聴データが無くても未参加と断定しない', async () => {
    const body = await list(`/api/webinars/${EXTERNAL_WEBINAR}/participants`);
    expect(body.data.measurement.state).toBe('unavailable');
    expect(body.data.measurement.reason).toContain('外部動画');
    expect(body.data.items.map((item) => item.classification)).toEqual(['unmeasured']);

    // 未参加・途中離脱・完了への絞り込みは断定できないため空。
    for (const filter of ['unviewed', 'dropped_off', 'completed']) {
      const filtered = await list(`/api/webinars/${EXTERNAL_WEBINAR}/participants?filter=${filter}`);
      expect(filtered.data.items).toEqual([]);
    }
    const unmeasured = await list(`/api/webinars/${EXTERNAL_WEBINAR}/participants?filter=unmeasured`);
    expect(unmeasured.data.items.map((item) => item.friendId)).toEqual([F_EXT]);
  });

  test('CSV は分類・ライブ/録画の列を持ち、filter で対象を絞って書き出せる', async () => {
    const all = await get(`/api/webinars/${WEBINAR}/participants.csv`);
    expect(all.status).toBe(200);
    const text = await all.text();
    expect(text).toContain('分類');
    expect(text).toContain('ライブ参加回数');
    expect(text).toContain('録画視聴回数');
    expect(text).toContain('未参加');
    expect(text).toContain('途中離脱');
    expect(text).toContain('視聴完了');

    const filtered = await get(`/api/webinars/${WEBINAR}/participants.csv?filter=unviewed`);
    const filteredText = await filtered.text();
    expect(filteredText).toContain(F_REG_ONLY);
    expect(filteredText).not.toContain(F_DONE);
    expect(filteredText).not.toContain(F_DROP);
  });
});
