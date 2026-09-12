import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTagDefinition, updateTagDefinition, assignTagToGroup } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAttributes } from './friend-attributes.js';
import { tags } from './tags.js';
import type { Env } from '../index.js';

let fixture: SqliteD1;
let actor: { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean; tenantId: string };
let app: Hono<Env>;
function req(path: string, method = 'GET', body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db });
}
function folder(id: string, account: string | null, kind = 'tag', parent: string | null = null) {
  fixture.raw.prepare(`INSERT INTO folders(id,kind,name,account_id,parent_id,created_at,updated_at)
    VALUES(?,?,?,?,?,'2026-01-01','2026-01-01')`).run(id, kind, id, account, parent);
}
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.prepare(`INSERT INTO tenants(id,name) VALUES('other','Other')`).run();
  for (const [id, tenant] of [['a', DEFAULT_TENANT_ID], ['b', DEFAULT_TENANT_ID], ['c', 'other']]) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,created_at,updated_at)
      VALUES(?,?,?,'test-secret','test-token',?,'2026-01-01','2026-01-01')`).run(id, id, id, tenant);
    folder(`folder-${id}`, id);
    fixture.raw.prepare(`INSERT INTO tags(id,name,normalized_name,line_account_id,folder_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'2026-01-01','2026-01-01')`).run(`tag-${id}`, `tag-${id}`, `tag-${id}`, id, `folder-${id}`);
  }
  folder('legacy', null);
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope)
    VALUES('limited','Limited','admin','test-api-key',?,'accounts')`).run(DEFAULT_TENANT_ID);
  fixture.raw.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('limited','a','2026-01-01')`).run();
  actor = { id: 'limited', name: 'Limited', role: 'admin', readOnly: false, tenantId: DEFAULT_TENANT_ID };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', actor); return next(); });
  app.route('/', friendAttributes);
  app.route('/', tags);
});
afterEach(() => fixture.raw.close());

describe('existing tag/folder endpoints enforce account ownership', () => {
  it.each(['/api/folders?kind=tag', '/api/folders', '/api/tag-groups'])(
    '%s lists only the assigned account, including when kind/account is omitted', async (url) => {
      const response = await req(url);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { id: string }[] };
      expect(body.data.map((row) => row.id)).toEqual(['folder-a']);
    });
  it('tenant-wide owner sees own tenant folders and can select one account', async () => {
    actor.id = 'env-owner'; actor.role = 'owner';
    for (const url of ['/api/folders?kind=tag&account_id=a', '/api/tag-groups?account_id=a']) {
      const response = await req(url);
      const body = await response.json() as { data: { id: string }[] };
      expect(body.data.map((row) => row.id).sort()).toEqual(['folder-a', 'legacy']);
    }
    const response = await req('/api/folders?kind=tag');
    expect(JSON.stringify(await response.json())).not.toContain('folder-c');
  });
  it.each(['b', 'c'])('cannot list/edit/delete another account %s via either folder API', async (id) => {
    expect((await req(`/api/folders?kind=tag&account_id=${id}`)).status).toBe(404);
    for (const prefix of ['/api/folders', '/api/tag-groups']) {
      expect((await req(`${prefix}/folder-${id}`, 'PATCH', { name: 'bad' })).status).toBe(404);
      expect((await req(`${prefix}/folder-${id}`, 'DELETE')).status).toBe(404);
    }
    expect(fixture.raw.prepare('SELECT name FROM folders WHERE id=?').get(`folder-${id}`)).toEqual({ name: `folder-${id}` });
  });
  it('cannot attach a tag or new child folder to another account', async () => {
    expect((await req('/api/tags/tag-a/group', 'PATCH', { groupId: 'folder-b' })).status).toBe(404);
    expect((await req('/api/folders', 'POST', { kind: 'tag', name: 'new', accountId: 'a', parentId: 'folder-b' })).status).toBe(400);
    expect((await req('/api/folders/folder-a', 'PATCH', { parentId: 'folder-b' })).status).toBe(400);
    expect(fixture.raw.prepare('SELECT folder_id FROM tags WHERE id=?').get('tag-a')).toEqual({ folder_id: 'folder-a' });
  });
  it('cannot mutate or inspect another account tag through legacy endpoints', async () => {
    for (const id of ['b', 'c']) {
      expect((await req(`/api/tags/tag-${id}/delete-impact`)).status).toBe(404);
      expect((await req(`/api/tags/tag-${id}`, 'PATCH', { name: 'bad' })).status).toBe(404);
      expect((await req(`/api/tags/tag-${id}/group`, 'PATCH', { groupId: null })).status).toBe(404);
      expect((await req(`/api/tags/tag-${id}/mileage`, 'PATCH', { multiplierBps: null })).status).toBe(404);
      expect((await req(`/api/tags/tag-${id}`, 'DELETE')).status).toBe(404);
    }
    expect((await req('/api/tags/reorder', 'PATCH', { ids: ['tag-a', 'tag-b'] })).status).toBe(404);
    const response = await req('/api/tags');
    expect((await response.json() as { data: { id: string }[] }).data.map((t) => t.id)).toEqual(['tag-a']);
  });
  it('creates account-owned folders through both APIs and preserves the existing tag when folder is deleted', async () => {
    for (const [url, body] of [
      ['/api/folders', { name: 'new', kind: 'tag', accountId: 'a' }],
      ['/api/tag-groups', { name: 'new2', accountId: 'a' }],
    ] as const) {
      const response = await req(url, 'POST', body);
      expect(response.status).toBe(201);
      const value = await response.json() as { data: { id: string; accountId: string | null } };
      expect(value.data.accountId).toBe('a');
      expect(fixture.raw.prepare('SELECT account_id FROM folders WHERE id=?').get(value.data.id)).toEqual({ account_id: 'a' });
    }
    expect((await req('/api/folders/folder-a', 'DELETE')).status).toBe(200);
    expect(fixture.raw.prepare('SELECT folder_id FROM tags WHERE id=?').get('tag-a')).toEqual({ folder_id: null });
  });
  it('denies unassigned folder changes and unscoped import to account-limited staff', async () => {
    expect((await req('/api/folders/legacy', 'PATCH', { name: 'bad' })).status).toBe(404);
    expect((await req('/api/tag-groups/legacy', 'DELETE')).status).toBe(404);
    expect((await req('/api/folders', 'POST', { kind: 'tag', name: 'bad' })).status).toBe(400);
    expect((await req('/api/tags/import/preview', 'POST', { rows: [] })).status).toBe(400);
  });
  it('deletes same-account descendants while preserving their tags as unfiled', async () => {
    folder('own-child', 'a', 'tag', 'folder-a');
    fixture.raw.prepare('UPDATE tags SET folder_id=? WHERE id=?').run('own-child', 'tag-a');
    expect((await req('/api/folders/folder-a', 'DELETE')).status).toBe(200);
    expect(fixture.raw.prepare('SELECT id FROM folders WHERE id=?').get('own-child')).toBeUndefined();
    expect(fixture.raw.prepare('SELECT folder_id FROM tags WHERE id=?').get('tag-a')).toEqual({ folder_id: null });
  });
  it('rejects a corrupted cross-account descendant without cascading', async () => {
    folder('bad-child', 'b', 'tag', 'folder-a');
    expect((await req('/api/folders/folder-a', 'DELETE')).status).toBe(409);
    expect(fixture.raw.prepare('SELECT id FROM folders WHERE id=?').get('bad-child')).toBeTruthy();
    expect((await req('/api/tag-groups/folder-a', 'DELETE')).status).toBe(409);
  });
  it('does not detach foreign-account tags from an already-corrupt folder relation', async () => {
    fixture.raw.prepare('UPDATE tags SET folder_id=? WHERE id=?').run('folder-a', 'tag-b');
    expect((await req('/api/folders/folder-a', 'DELETE')).status).toBe(409);
    expect(fixture.raw.prepare('SELECT folder_id FROM tags WHERE id=?').get('tag-b')).toEqual({ folder_id: 'folder-a' });
  });
  it('reordering own tags leaves other account display order untouched', async () => {
    fixture.raw.prepare(`INSERT INTO tags(id,name,line_account_id,display_order) VALUES('tag-a2','tag-a2','a',8)`).run();
    fixture.raw.prepare('UPDATE tags SET display_order=99 WHERE id=?').run('tag-b');
    expect((await req('/api/tags/reorder', 'PATCH', { ids: ['tag-a2', 'tag-a'] })).status).toBe(200);
    expect(fixture.raw.prepare('SELECT display_order FROM tags WHERE id=?').get('tag-b')).toEqual({ display_order: 99 });
  });
  it('keeps webinar account_id required and supports own-account folder lifecycle', async () => {
    folder('webinar-a', 'a', 'webinar'); folder('webinar-b', 'b', 'webinar');
    expect((await req('/api/folders?kind=webinar')).status).toBe(400);
    expect((await req('/api/folders/webinar-b', 'PATCH', { accountId: 'a', name: 'bad' })).status).toBe(404);
    expect((await req('/api/folders/webinar-a', 'PATCH', { accountId: 'a', name: 'valid' })).status).toBe(200);
    expect((await req('/api/folders/webinar-a?account_id=a', 'DELETE')).status).toBe(200);
  });
  it('DB tag definition create/update refuses a folder owned by another account', async () => {
    await expect(createTagDefinition(fixture.db, { lineAccountId: 'a', name: 'new', groupId: 'folder-b',
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 } })).rejects.toMatchObject({ code: 'folder_not_found' });
    await expect(updateTagDefinition(fixture.db, { tagId: 'tag-a', lineAccountId: 'a', expectedVersion: 1, groupId: 'folder-b' }))
      .rejects.toMatchObject({ code: 'folder_not_found' });
    expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual({ n: 3 });
  });
  it('DB assignment rejects a foreign folder and advances the own-account tag version', async () => {
    expect(await assignTagToGroup(fixture.db, 'tag-a', 'folder-b')).toBeNull();
    const before = fixture.raw.prepare('SELECT version FROM tags WHERE id=?').get('tag-a') as { version: number };
    const tag = await assignTagToGroup(fixture.db, 'tag-a', null);
    expect(tag?.folder_id).toBeNull();
    expect(tag?.version).toBe(before.version + 1);
  });
  it('staff role cannot edit even own folder', async () => {
    actor.role = 'staff';
    expect((await req('/api/folders/folder-a', 'PATCH', { name: 'bad' })).status).toBe(403);
    expect((await req('/api/tag-groups/folder-a', 'DELETE')).status).toBe(403);
  });
});
