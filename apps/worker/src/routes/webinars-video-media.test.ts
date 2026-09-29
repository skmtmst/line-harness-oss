/*
 * N-115: ウェビナー動画の指定を R2 prefix 自由入力からメディア選択へ変える。
 *
 * 実SQLite（bootstrap.sql を流した better-sqlite3）に実物の webinars
 * ルートを当て、認証も実物（Bearer APIキー → staff_members → 役割・
 * account境界）で通す。R2 へは触れない（参照はキー文字列だけ）。
 *
 * 直す前: PUT/POST は videoPrefix の文字列をそのまま保存し、実在しない
 * prefix や別アカウントの領域も通った。直す後: videoMediaId で
 * メディアを選ぶと同じアカウントの kind='video' だけが受理され、
 * 保存値 video_prefix はそのメディアの r2_key から生成される。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const TENANT = 'tenant-1';
const ACC_A = 'acc-a';
const ACC_B = 'acc-b';
const KEY_OWNER = 'key-owner-aaa';
const KEY_STAFF_B = 'key-staff-bbb';

const WEBINAR_A = 'webinar-a';
const WEBINAR_B = 'webinar-b';

const MEDIA_VIDEO_A = 'med-video-a';
const MEDIA_IMAGE_A = 'med-image-a';
const MEDIA_VIDEO_B = 'med-video-b';

function seed(sqlite: SqliteD1['raw']) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES (?, '統括1')`).run(TENANT);
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', ?)`,
    ).run(id, `channel-${id}`, id, TENANT);
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, ?, 'all')`,
  ).run(KEY_OWNER, TENANT);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('staff-b', '担当', 'staff', ?, ?, 'accounts', '["/webinars"]')`,
  ).run(KEY_STAFF_B, TENANT);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-b', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_B);

  for (const [id, accountId, videoPrefix] of [
    [WEBINAR_A, ACC_A, null],
    [WEBINAR_B, ACC_B, 'webinars/legacy-set'],
  ] as const) {
    sqlite.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, status, video_prefix, duration_seconds, schedule_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, 1800, '[]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(id, accountId, `ウェビナー${id}`, `slug-${id}`, videoPrefix);
  }

  for (const [id, accountId, kind, r2Key] of [
    [MEDIA_VIDEO_A, ACC_A, 'video', 'media/acc-a/video-1.mp4'],
    [MEDIA_IMAGE_A, ACC_A, 'image', 'media/acc-a/image-1.png'],
    [MEDIA_VIDEO_B, ACC_B, 'video', 'media/acc-b/video-9.mp4'],
  ] as const) {
    sqlite.prepare(
      `INSERT INTO media (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
       VALUES (?, ?, ?, ?, 'application/octet-stream', 1000, ?, '2026-09-01T00:00:00.000Z')`,
    ).run(id, accountId, kind, `file-${id}`, r2Key);
  }
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

function put(webinarId: string, apiKey: string | null, body: Record<string, unknown>) {
  return app().request(`/api/webinars/${webinarId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  }, env());
}

function get(webinarId: string, apiKey: string) {
  return app().request(`/api/webinars/${webinarId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env());
}

function post(apiKey: string, body: Record<string, unknown>) {
  return app().request('/api/webinars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, env());
}

function savedPrefix(webinarId: string): string | null {
  const row = sqlite.raw
    .prepare('SELECT video_prefix FROM webinars WHERE id = ?')
    .get(webinarId) as { video_prefix: string | null };
  return row.video_prefix;
}

beforeEach(async () => {
  sqlite = createTestD1();
  seed(sqlite.raw);
  ({ webinarRoutes } = await import('./webinars.js'));
});

describe('ウェビナー動画のメディア選択 (N-115)', () => {
  test('同じアカウントの動画メディアを選ぶと、保存値はそのr2_keyになる', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, { videoMediaId: MEDIA_VIDEO_A });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { videoPrefix: string; videoMediaId: string } };
    expect(body.data.videoPrefix).toBe('media/acc-a/video-1.mp4');
    expect(body.data.videoMediaId).toBe(MEDIA_VIDEO_A);
    expect(savedPrefix(WEBINAR_A)).toBe('media/acc-a/video-1.mp4');

    const got = await get(WEBINAR_A, KEY_OWNER);
    const detail = await got.json() as { data: { videoMediaId: string | null } };
    expect(detail.data.videoMediaId).toBe(MEDIA_VIDEO_A);
  });

  test('動画でないメディアは拒否する', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, { videoMediaId: MEDIA_IMAGE_A });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('video_media_not_video');
    expect(savedPrefix(WEBINAR_A)).toBeNull();
  });

  test('別アカウントのメディアは選べない', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, { videoMediaId: MEDIA_VIDEO_B });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('video_media_not_found');
    expect(savedPrefix(WEBINAR_A)).toBeNull();
  });

  test('存在しないメディアIDは拒否する', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, { videoMediaId: 'missing-media' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('video_media_not_found');
  });

  test('videoMediaIdとvideoPrefixの同時指定は拒否する', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, {
      videoMediaId: MEDIA_VIDEO_A,
      videoPrefix: 'hand-written/prefix',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('ambiguous_video_source');
    expect(savedPrefix(WEBINAR_A)).toBeNull();
  });

  test('videoMediaId: null で動画を解除できる', async () => {
    const res = await put(WEBINAR_B, KEY_OWNER, { videoMediaId: null });
    expect(res.status).toBe(200);
    expect(savedPrefix(WEBINAR_B)).toBeNull();
    const got = await get(WEBINAR_B, KEY_OWNER);
    expect((await got.json() as { data: { videoMediaId: string | null } }).data.videoMediaId).toBeNull();
  });

  test('videoMediaIdを送らなければ既存のprefixはそのまま', async () => {
    const res = await put(WEBINAR_B, KEY_OWNER, { title: '別の題名' });
    expect(res.status).toBe(200);
    expect(savedPrefix(WEBINAR_B)).toBe('webinars/legacy-set');
    // ライブラリ外のprefixはメディアIDに解決できないので null を返す
    const got = await get(WEBINAR_B, KEY_OWNER);
    expect((await got.json() as { data: { videoMediaId: string | null } }).data.videoMediaId).toBeNull();
  });

  test('新規作成でもvideoMediaIdで選べる', async () => {
    const res = await post(KEY_OWNER, {
      accountId: ACC_A,
      title: '新しいウェビナー',
      slug: 'new-webinar',
      status: 'draft',
      durationSeconds: 3600,
      schedule: [],
      videoMediaId: MEDIA_VIDEO_A,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; videoPrefix: string; videoMediaId: string } };
    expect(body.data.videoPrefix).toBe('media/acc-a/video-1.mp4');
    expect(body.data.videoMediaId).toBe(MEDIA_VIDEO_A);
  });

  test('staffが自分の範囲外のウェビナーへは変更できない', async () => {
    const res = await put(WEBINAR_A, KEY_STAFF_B, { videoMediaId: MEDIA_VIDEO_B });
    expect(res.status).toBe(404);
    expect(savedPrefix(WEBINAR_A)).toBeNull();
  });
});
