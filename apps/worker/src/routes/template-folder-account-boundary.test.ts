import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAttributes } from './friend-attributes.js';
import { templates } from './templates.js';
import type { Env } from '../index.js';

/*
 * N-147: テンプレートのフォルダは選択中のLINE公式アカウント単位。
 * 一覧・作成・更新・削除・並べ替えがアカウント内だけに効き、
 * 別アカウントのフォルダは404、別アカウントのフォルダへテンプレートを
 * 入れることもできないことを実DBで固定する（tag の境界と同じ決まり）。
 */

let fixture: SqliteD1;
let actor: { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean; tenantId: string };
let app: Hono<Env>;

function req(path: string, method = 'GET', body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db });
}
function folder(id: string, account: string | null, parent: string | null = null) {
  fixture.raw.prepare(`INSERT INTO folders(id,kind,name,account_id,parent_id,display_order,created_at,updated_at)
    VALUES(?,?,?,?,?,0,'2026-01-01','2026-01-01')`).run(id, 'template', id, account, parent);
}

beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  for (const id of ['a', 'b']) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,created_at,updated_at)
      VALUES(?,?,?,'test-secret','test-token',?,'2026-01-01','2026-01-01')`).run(id, id, id, DEFAULT_TENANT_ID);
    folder(`folder-${id}`, id);
    fixture.raw.prepare(`INSERT INTO templates(id,name,message_type,message_content,line_account_id,created_at,updated_at)
      VALUES(?,?,?,'本文',?,'2026-01-01','2026-01-01')`).run(`tpl-${id}`, `tpl-${id}`, 'text', id);
  }
  folder('legacy', null);
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope)
    VALUES('limited','Limited','admin','test-api-key',?,'accounts')`).run(DEFAULT_TENANT_ID);
  fixture.raw.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('limited','a','2026-01-01')`).run();
  actor = { id: 'limited', name: 'Limited', role: 'admin', readOnly: false, tenantId: DEFAULT_TENANT_ID };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', actor); return next(); });
  app.route('/', friendAttributes);
  app.route('/', templates);
});
afterEach(() => fixture.raw.close());

describe('テンプレートフォルダのアカウント境界（N-147）', () => {
  it('一覧は選択アカウント内だけに効き、他アカウントと未所属を出さない', async () => {
    const scoped = await (await req('/api/folders?kind=template&account_id=a')).json() as { data: { id: string }[] };
    expect(scoped.data.map((row) => row.id)).toEqual(['folder-a']);
    // 種別だけの一覧でも他アカウント・未所属のテンプレートフォルダは出ない
    const all = await (await req('/api/folders?kind=template')).json() as { data: { id: string }[] };
    expect(all.data.map((row) => row.id)).toEqual(['folder-a']);
  });

  it('選択可能範囲外のアカウントIDは404として扱う', async () => {
    expect((await req('/api/folders?kind=template&account_id=b')).status).toBe(404);
  });

  it('作成は選択アカウントへ効く。範囲外・未指定は作らせない', async () => {
    expect((await req('/api/folders', 'POST', { kind: 'template', name: '新しい', accountId: 'a' })).status).toBe(201);
    const created = await (await req('/api/folders', 'POST', { kind: 'template', name: '新しい2', accountId: 'a' })).json() as { data: { id: string; accountId: string | null } };
    expect(created.data.accountId).toBe('a');
    expect(fixture.raw.prepare('SELECT account_id FROM folders WHERE id=?').get(created.data.id)).toEqual({ account_id: 'a' });
    // 他アカウント宛て・未指定（共有）は作れない
    expect((await req('/api/folders', 'POST', { kind: 'template', name: 'bad', accountId: 'b' })).status).toBe(404);
    expect((await req('/api/folders', 'POST', { kind: 'template', name: 'bad' })).status).toBe(400);
  });

  it('他アカウントのフォルダは更新・削除・並べ替えのどれでも404', async () => {
    expect((await req('/api/folders/folder-b', 'PATCH', { name: 'bad' })).status).toBe(404);
    expect((await req('/api/folders/folder-b', 'DELETE')).status).toBe(404);
    expect((await req('/api/folders/folder-b?account_id=a', 'DELETE')).status).toBe(404);
    // 自分の選択アカウントとずれる account_id 指定も404
    expect((await req('/api/folders/folder-a?account_id=b', 'PATCH', { name: 'bad' })).status).toBe(404);
    expect(fixture.raw.prepare('SELECT name FROM folders WHERE id=?').get('folder-b')).toEqual({ name: 'folder-b' });
    // 自分のアカウント内では更新できる
    expect((await req('/api/folders/folder-a?account_id=a', 'PATCH', { name: '直した' })).status).toBe(200);
  });

  it('未所属（共有）のテンプレートフォルダはアカウント限定の人には触らせない', async () => {
    expect((await req('/api/folders/legacy', 'PATCH', { name: 'bad' })).status).toBe(404);
    expect((await req('/api/folders/legacy?account_id=a', 'DELETE')).status).toBe(404);
    expect(fixture.raw.prepare('SELECT name FROM folders WHERE id=?').get('legacy')).toEqual({ name: 'legacy' });
  });

  it('別アカウントのフォルダへテンプレートを入れさせない', async () => {
    // 作成時
    const created = await req('/api/templates', 'POST', {
      accountId: 'a', name: '新規', messageType: 'text', messageContent: '本文', folderId: 'folder-b',
    });
    expect(created.status).toBe(422);
    // 更新（置き場の移動）時
    expect((await req('/api/templates/tpl-a', 'PUT', { folderId: 'folder-b' })).status).toBe(422);
    expect(fixture.raw.prepare('SELECT folder_id FROM templates WHERE id=?').get('tpl-a')).toEqual({ folder_id: null });
    // 同じアカウントのフォルダには入れられる
    expect((await req('/api/templates/tpl-a', 'PUT', { folderId: 'folder-a' })).status).toBe(200);
    expect(fixture.raw.prepare('SELECT folder_id FROM templates WHERE id=?').get('tpl-a')).toEqual({ folder_id: 'folder-a' });
    // 未所属（共有）フォルダは「見えない人」へは入れさせない。一覧・更新・削除と同じ境界。
    expect((await req('/api/templates/tpl-a', 'PUT', { folderId: 'legacy' })).status).toBe(422);
    expect(fixture.raw.prepare('SELECT folder_id FROM templates WHERE id=?').get('tpl-a')).toEqual({ folder_id: 'folder-a' });
    // 全アカウントを見られる人は従来どおり共有フォルダを使える
    actor.id = 'env-owner'; actor.role = 'owner';
    expect((await req('/api/templates/tpl-a', 'PUT', { folderId: 'legacy' })).status).toBe(200);
  });
});
