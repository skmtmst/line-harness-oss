/* N-185/N-186 直接試験: 実route＋実SQLite。確認値の契約と公開版の走査を守る。 */
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { test, expect } from 'vitest';

const { createTestD1, insertFriend } = await import('../test-utils/d1-sqlite.js');
const { contents } = await import('./contents.js');
const { authMiddleware } = await import('../middleware/auth.js');

function setup() {
  const t = createTestD1();
  const raw = t.raw;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(DEFAULT_TENANT_ID, 'T');
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('acc-a','ch-a','A','t','s',1,?), ('acc-b','ch-b','B','t','s',1,?)`).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  raw.prepare(`INSERT INTO staff_members (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES ('owner-1','o','owner','full','key-owner','["/contents/vars"]','all',?)`).run(DEFAULT_TENANT_ID);
  insertFriend(raw, 'f1', { line_account_id: 'acc-a', line_user_id: 'U-f1' });
  raw.prepare(`INSERT INTO common_vars (id, line_account_id, name, var_key, type, value, version)
    VALUES ('cv-1','acc-a','営業時間','shop_hours','text','10-19',1)`).run();
  // 公開版スナップショットだけに差し込みがあるシナリオ（編集中の下書きには無い）
  raw.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
    VALUES ('sc-1','案内','manual',1,'acc-a')`).run();
  raw.prepare(`INSERT INTO scenario_steps (id, scenario_id, step_order, message_type, message_content)
    VALUES ('st-live','sc-1',0,'text','本文（差し込みなし）')`).run();
  raw.prepare(`INSERT INTO scenario_versions (id, scenario_id, version_number, status, steps_snapshot, actions_snapshot, published_at, created_at, updated_at)
    VALUES ('sv-1','sc-1',1,'published','[{"messageContent":"営業時間は{{var.shop_hours}}です"}]','[]','2026-09-14T10:00:00+09:00','2026-09-14T10:00:00+09:00','2026-09-14T10:00:00+09:00')`).run();
  // 別アカウントの使用先（混ぜてはいけない）
  raw.prepare(`INSERT INTO templates (id, name, message_type, message_content, line_account_id)
    VALUES ('tpl-b','他店案内','text','他店は{{var.shop_hours}}です','acc-b')`).run();

  const app = new Hono<any>();
  app.use('*', authMiddleware);
  app.route('/', contents);
  const env = { DB: t.db } as any;
  const req = async (path: string, key?: string, init?: RequestInit): Promise<Response> =>
    app.request(path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init?.headers ?? {}) } }, env);
  const J = { 'content-type': 'application/json' };
  return { t, raw, req, J };
}

async function previewToken(req: (path: string, key?: string, init?: RequestInit) => Promise<Response>, J: Record<string, string>, value = '11-20') {
  const r = await req('/api/common-vars/cv-1/impact-preview?accountId=acc-a', 'key-owner', {
    method: 'POST', headers: J, body: JSON.stringify({ accountId: 'acc-a', nextValue: value }),
  });
  expect(r.status).toBe(200);
  const b = await r.json() as any;
  return b.data as { impactProof: string; version: number; items: Array<{ name: string }> };
}

test('N-185 確認値なしの保存は428で止まり値は変わらない', async () => {
  const { t, raw, req, J } = setup();
  const r = await req('/api/common-vars/cv-1?accountId=acc-a', 'key-owner', {
    method: 'PATCH', headers: J, body: JSON.stringify({ value: '11-20' }),
  });
  expect(r.status).toBe(428);
  expect((raw.prepare('SELECT value FROM common_vars WHERE id = ?').get('cv-1') as { value: string }).value).toBe('10-19');
  t.raw.close();
});

test('N-185 正しい確認値で保存でき使い回しは409', async () => {
  const { t, raw, req, J } = setup();
  const first = await previewToken(req, J);
  const ok = await req('/api/common-vars/cv-1?accountId=acc-a', 'key-owner', {
    method: 'PATCH', headers: J, body: JSON.stringify({ value: '11-20', impactProof: first.impactProof }),
  });
  expect(ok.status).toBe(200);
  // 使い回し（版が進んだ古い確認値）は409
  const reuse = await req('/api/common-vars/cv-1?accountId=acc-a', 'key-owner', {
    method: 'PATCH', headers: J, body: JSON.stringify({ value: '11-21', impactProof: first.impactProof }),
  });
  expect(reuse.status).toBe(409);
  // 別IDの確認値は409
  const other = await req('/api/common-vars/cv-1?accountId=acc-a', 'key-owner', {
    method: 'PATCH', headers: J, body: JSON.stringify({ value: '11-21', impactProof: `other-id.1.${'0'.repeat(64)}` }),
  });
  expect(other.status).toBe(409);
  t.raw.close();
});

test('N-185 確認後に使用先が変われば409', async () => {
  const { t, raw, req, J } = setup();
  const first = await previewToken(req, J);
  raw.prepare(`INSERT INTO templates (id, name, message_type, message_content, line_account_id)
    VALUES ('tpl-new','追加案内','text','追加は{{var.shop_hours}}です','acc-a')`).run();
  const r = await req('/api/common-vars/cv-1?accountId=acc-a', 'key-owner', {
    method: 'PATCH', headers: J, body: JSON.stringify({ value: '11-20', impactProof: first.impactProof }),
  });
  expect(r.status).toBe(409);
  expect((await r.json() as any).code).toBe('impact_usage_changed');
  t.raw.close();
});

test('N-186 公開版だけの参照を見つけ別境界を混ぜない', async () => {
  const { t, req, J } = setup();
  const data = await previewToken(req, J);
  const names = data.items.map((i) => i.name);
  // 公開版スナップショットを見つける（編集中の下書きと混同しない）
  expect(names.some((n) => n.includes('公開版v1'))).toBe(true);
  // 別アカウントの使用先は混ざらない
  expect(names.some((n) => n.includes('他店'))).toBe(false);
  t.raw.close();
});
