/*
 * N-116: ウェビナーの視聴後アクションが参照する設定を、保存前に
 * 「実在する・同じアカウントのもの・使える状態」まで検証する。
 *
 * 実SQLite（bootstrap.sql を流した better-sqlite3）に実物の webinars
 * ルートを当て、認証も実物（Bearer APIキー → staff_members → 役割・
 * account境界）で通す。外部送信は走らない。
 *
 * 直す前: PUT /api/webinars/:id/actions は形（配列・trigger・種別・
 * configがオブジェクト）だけを検査し、存在しないIDや別アカウントのIDも
 * 200で保存した。幽霊参照は公開・実行時に不発になり、別アカウントの
 * 参照は境界を越える。
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
const KEY_STAFF_A = 'key-staff-aaa';
const KEY_STAFF_B = 'key-staff-bbb';

const WEBINAR_A = 'webinar-a';
const WEBINAR_B = 'webinar-b';

// acc-a 側の有効な参照
const TAG_A = 'tag-a1';
const SCN_A = 'scn-a1';
const TPL_A = 'tpl-a1';
const WH_A = 'wh-a1';
const RMP_A = 'rmp-a1';
// acc-a 側の使えない参照（アーカイブ・停止・未公開）
const TAG_A_ARCHIVED = 'tag-a-archived';
const WH_A_INACTIVE = 'wh-a-inactive';
const RMP_A_DRAFT = 'rmp-a-draft';
// acc-b 側の参照（別アカウント）
const TAG_B = 'tag-b1';
const SCN_B = 'scn-b1';
const TPL_B = 'tpl-b1';
const WH_B = 'wh-b1';
const RMP_B = 'rmp-b1';

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
  for (const [staffId, key, acc] of [['staff-a', KEY_STAFF_A, ACC_A], ['staff-b', KEY_STAFF_B, ACC_B]] as const) {
    sqlite.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
       VALUES (?, '担当', 'staff', ?, ?, 'accounts', '["/webinars"]')`,
    ).run(staffId, key, TENANT);
    sqlite.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
       VALUES (?, ?, '2026-09-01T00:00:00.000Z')`,
    ).run(staffId, acc);
  }

  for (const [id, accountId] of [[WEBINAR_A, ACC_A], [WEBINAR_B, ACC_B]] as const) {
    sqlite.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1800, '[]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(id, accountId, `ウェビナー${id}`, `slug-${id}`);
  }

  // タグ: 有効 / アーカイブ済み / 別アカウント
  for (const [id, accountId, status] of [
    [TAG_A, ACC_A, 'active'],
    [TAG_A_ARCHIVED, ACC_A, 'archived'],
    [TAG_B, ACC_B, 'active'],
  ] as const) {
    sqlite.prepare(`INSERT INTO tags (id, name, line_account_id, status) VALUES (?, ?, ?, ?)`)
      .run(id, `タグ${id}`, accountId, status);
  }
  // シナリオ: 自アカウント / 別アカウント
  for (const [id, accountId] of [[SCN_A, ACC_A], [SCN_B, ACC_B]] as const) {
    sqlite.prepare(`INSERT INTO scenarios (id, name, trigger_type, line_account_id) VALUES (?, ?, 'manual', ?)`)
      .run(id, `シナリオ${id}`, accountId);
  }
  // テンプレート: 自アカウント / 別アカウント
  for (const [id, accountId] of [[TPL_A, ACC_A], [TPL_B, ACC_B]] as const) {
    sqlite.prepare(`INSERT INTO templates (id, name, message_type, message_content, line_account_id) VALUES (?, ?, 'text', '本文', ?)`)
      .run(id, `テンプレート${id}`, accountId);
  }
  // 送信Webhook: 有効 / 停止 / 別アカウント
  for (const [id, accountId, active] of [
    [WH_A, ACC_A, 1],
    [WH_A_INACTIVE, ACC_A, 0],
    [WH_B, ACC_B, 1],
  ] as const) {
    sqlite.prepare(`INSERT INTO outgoing_webhooks (id, name, url, line_account_id, is_active) VALUES (?, ?, 'https://example.com/hook', ?, ?)`)
      .run(id, `Webhook${id}`, accountId, active);
  }
  // リッチメニュー: 公開グループのページ / 下書きグループのページ / 別アカウント
  for (const [groupId, accountId, status] of [
    ['rmg-a1', ACC_A, 'published'],
    ['rmg-a-draft', ACC_A, 'draft'],
    ['rmg-b1', ACC_B, 'published'],
  ] as const) {
    sqlite.prepare(
      `INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size, status)
       VALUES (?, ?, ?, 'メニュー', 'large', ?)`,
    ).run(groupId, accountId, `グループ${groupId}`, status);
  }
  for (const [pageId, groupId] of [
    [RMP_A, 'rmg-a1'],
    [RMP_A_DRAFT, 'rmg-a-draft'],
    [RMP_B, 'rmg-b1'],
  ] as const) {
    sqlite.prepare(
      `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
       VALUES (?, ?, 0, ?, ?)`,
    ).run(pageId, groupId, `ページ${pageId}`, `alias-${pageId}`);
  }
}

let sqlite: SqliteD1;
let webinarRoutes: Awaited<typeof import('./webinars.js')>['webinarRoutes'];

function app() {
  const instance = new Hono<Env>();
  // 認証は実物。Bearer APIキー → staff_members → 役割・権限・account境界まで本番通り。
  instance.use('*', authMiddleware);
  instance.route('/', webinarRoutes);
  return instance;
}

const env = () => ({ DB: sqlite.db }) as unknown as Env['Bindings'];

function put(webinarId: string, apiKey: string | null, actions: unknown[]) {
  return app().request(`/api/webinars/${webinarId}/actions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ actions }),
  }, env());
}

function get(webinarId: string, apiKey: string, path = 'actions') {
  return app().request(`/api/webinars/${webinarId}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env());
}

function savedActionCount(webinarId: string): number {
  const row = sqlite.raw
    .prepare('SELECT COUNT(*) AS n FROM webinar_actions WHERE webinar_id = ? AND enabled = 1')
    .get(webinarId) as { n: number };
  return row.n;
}

const completed = (actionType: string, config: Record<string, unknown>) => ({
  trigger: 'completed',
  actionType,
  config,
});

// 参照を持つ全種別 → { 種別, 参照キー, acc-aで有効なconfig, acc-bのconfig }
const REFERENCE_CASES = [
  { type: 'add_tag', key: 'tagId', valid: { tagId: TAG_A }, cross: { tagId: TAG_B } },
  { type: 'remove_tag', key: 'tagId', valid: { tagId: TAG_A }, cross: { tagId: TAG_B } },
  { type: 'start_scenario', key: 'scenarioId', valid: { scenarioId: SCN_A }, cross: { scenarioId: SCN_B } },
  { type: 'stop_scenario', key: 'scenarioId', valid: { scenarioId: SCN_A }, cross: { scenarioId: SCN_B } },
  { type: 'resume_scenario', key: 'scenarioId', valid: { scenarioId: SCN_A }, cross: { scenarioId: SCN_B } },
  { type: 'send_message', key: 'templateId', valid: { templateId: TPL_A }, cross: { templateId: TPL_B } },
  { type: 'send_webhook', key: 'webhookId', valid: { webhookId: WH_A }, cross: { webhookId: WH_B } },
  { type: 'switch_rich_menu', key: 'richMenuPageId', valid: { richMenuPageId: RMP_A }, cross: { richMenuPageId: RMP_B } },
] as const;

beforeEach(async () => {
  sqlite = createTestD1();
  seed(sqlite.raw);
  ({ webinarRoutes } = await import('./webinars.js'));
});

describe('ウェビナーアクション参照検証 (N-116)', () => {
  test('全種別の実在・同一アカウント参照と参照なしactionを保存できる (200)', async () => {
    const actions = [
      ...REFERENCE_CASES.map(({ type, valid }) => completed(type, valid)),
      completed('remove_rich_menu', {}),
    ];
    const res = await put(WEBINAR_A, KEY_OWNER, actions);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(actions.length);
    expect(savedActionCount(WEBINAR_A)).toBe(actions.length);
  });

  test('別アカウントのウェビナーには別アカウントの参照基準で保存できる (200)', async () => {
    const res = await put(WEBINAR_B, KEY_OWNER, [
      completed('add_tag', { tagId: TAG_B }),
      completed('start_scenario', { scenarioId: SCN_B }),
    ]);
    expect(res.status).toBe(200);
    expect(savedActionCount(WEBINAR_B)).toBe(2);
  });

  test.each(REFERENCE_CASES)('存在しない参照は422で1件も保存しない: $type', async ({ type, key }) => {
    const res = await put(WEBINAR_A, KEY_OWNER, [completed(type, { [key]: 'no-such-id' })]);
    expect(res.status).toBe(422);
    expect(savedActionCount(WEBINAR_A)).toBe(0);
  });

  test.each(REFERENCE_CASES)('別アカウントの参照は422で1件も保存しない: $type', async ({ type, cross }) => {
    const res = await put(WEBINAR_A, KEY_OWNER, [completed(type, cross)]);
    expect(res.status).toBe(422);
    // 別アカウント側に実在しても「見つからない」と同じ扱いで、存在を応答で区別できない。
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(savedActionCount(WEBINAR_A)).toBe(0);
  });

  test.each(REFERENCE_CASES)('必須IDが欠落していても422で保存しない: $type', async ({ type, key }) => {
    for (const config of [{}, { [key]: '' }, { [key]: '   ' }]) {
      const res = await put(WEBINAR_A, KEY_OWNER, [completed(type, config)]);
      expect(res.status).toBe(422);
    }
    expect(savedActionCount(WEBINAR_A)).toBe(0);
  });

  test('有効なactionと無効なactionが混在していても全体を拒否して1件も保存しない', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, [
      completed('add_tag', { tagId: TAG_A }),
      completed('start_scenario', { scenarioId: 'no-such-id' }),
      completed('remove_rich_menu', {}),
    ]);
    expect(res.status).toBe(422);
    expect(savedActionCount(WEBINAR_A)).toBe(0);
  });

  test('アーカイブ済みタグ・停止中Webhook・未公開リッチメニューは422で保存しない', async () => {
    for (const action of [
      completed('add_tag', { tagId: TAG_A_ARCHIVED }),
      completed('send_webhook', { webhookId: WH_A_INACTIVE }),
      completed('switch_rich_menu', { richMenuPageId: RMP_A_DRAFT }),
    ]) {
      const res = await put(WEBINAR_A, KEY_OWNER, [action]);
      expect(res.status).toBe(422);
    }
    expect(savedActionCount(WEBINAR_A)).toBe(0);
  });

  test('remove_rich_menu は参照を持たないので空configでも保存できる', async () => {
    const res = await put(WEBINAR_A, KEY_OWNER, [completed('remove_rich_menu', {})]);
    expect(res.status).toBe(200);
    expect(savedActionCount(WEBINAR_A)).toBe(1);
  });

  test('別アカウントのウェビナー自体は従来どおり404', async () => {
    const res = await put(WEBINAR_A, KEY_STAFF_B, [completed('add_tag', { tagId: TAG_B })]);
    expect(res.status).toBe(404);
    // 403 ではなく 404 —— 別アカウントのウェビナーの存在自体を返さない。
  });

  test('staff は owner/admin 限定なので403', async () => {
    const res = await put(WEBINAR_A, KEY_STAFF_A, [completed('add_tag', { tagId: TAG_A })]);
    expect(res.status).toBe(403);
  });

  test('保存済みの幽霊参照は公開前検証で failed になる', async () => {
    // 検証を通る前に保存された古い設定や、検査と保存の間に消えた参照を想定し、
    // 保存済み行を直接用意して公開前検証にかける。
    sqlite.raw.prepare(
      `INSERT INTO webinar_actions (id, webinar_id, trigger, action_type, config_json, position, version, enabled, created_at, updated_at)
       VALUES ('wa-ghost', ?, 'completed', 'add_tag', ?, 0, 1, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(WEBINAR_A, JSON.stringify({ tagId: 'no-such-id' }));
    const res = await get(WEBINAR_A, KEY_OWNER, 'publish-validation');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { checks: Array<{ key: string; status: string }> } };
    const check = body.data.checks.find((item) => item.key === 'action_dependencies');
    expect(check?.status).toBe('failed');
  });
});
