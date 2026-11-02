import { Hono } from 'hono';
import { expect, test } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { richMenuGroups } from './rich-menu-groups.js';

test('作成した下書きの削除は版が進んだら拒否し、一致した版だけ消す', async () => {
  const { db, raw } = createTestD1();
  try {
    raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES ('a','店舗','channel','x','x');
      INSERT INTO staff_members(id,name,role,api_key) VALUES ('owner','管理者','owner','test-key');
      INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,status,version,created_at,updated_at) VALUES ('menu','a','案内','メニュー','large','draft',4,'2026','2026');`);
    const app = new Hono<Env>();
    app.use('*', async (c, next) => { c.set('staff', { id:'owner', name:'管理者', role:'owner', readOnly:false }); await next(); });
    app.route('/', richMenuGroups);
    const request = (version:number) => app.request(`/api/rich-menu-groups/menu?expectedVersion=${version}`, {method:'DELETE'}, {DB:db});
    expect((await request(3)).status).toBe(409);
    expect(raw.prepare("SELECT version FROM rich_menu_groups WHERE id='menu'").get()).toEqual({version:4});
    expect((await request(4)).status).toBe(200);
    expect(raw.prepare("SELECT id FROM rich_menu_groups WHERE id='menu'").get()).toBeUndefined();
  } finally { raw.close(); }
});
