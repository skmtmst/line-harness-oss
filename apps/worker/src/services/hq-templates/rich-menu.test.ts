import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { createRichMenuHqTemplateAdapter, executeRichMenuHqPlan, type RichMenuHqDefinition } from './rich-menu.js';
import type { HqTemplateAdapterContext, HqTemplateStatement, HqTemplateStoreAtomicCommitPlan } from './contract.js';

const resources: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const r of resources.splice(0)) r.raw.close(); });
function fixture() {
  const sql = createTestD1({ foreignKeys: true }); resources.push(sql);
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant','HQ'),('other','Other');`);
  for (const account of ['a', 'b', 'c', 'outside']) {
    sql.raw.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES (?,?,?,?,?,?)').run(account, account, account, 'test-only', 'test-only', account === 'outside' ? 'other' : 'tenant');
    sql.raw.prepare('INSERT INTO tags(id,name,line_account_id) VALUES (?,?,?)').run(`tag-${account}`, `Tag-${account}`, account);
    sql.raw.prepare('INSERT INTO forms(id,name) VALUES (?,?)').run(`form-${account}`, 'Form');
    sql.raw.prepare('INSERT INTO form_accounts VALUES (?,?,?)').run(`form-${account}`, account, 'now');
    sql.raw.prepare("INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES (?,?,'manual',?)").run(`scenario-${account}`, 'Scenario', account);
  }
  const definition: RichMenuHqDefinition = { schemaVersion: 1, richMenu: { id: 'menu', name: 'Menu', chatBarText: '開く', size: 'large', defaultPageId: 'p1', pages: [
    { id: 'p1', name: 'One', imageR2Key: 'hq-templates/tenant/image1', areas: [{ id: 'ar1', bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'postback', actionData: {}, intent: 'form', formId: 'source-form', scenarioId: 'source-scenario', tagIds: ['source-tag'] }] },
    { id: 'p2', name: 'Two', imageR2Key: 'hq-templates/tenant/image2', areas: [{ id: 'ar2', bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'richmenuswitch', actionData: { targetPageId: 'p1' }, intent: 'switch' }] },
  ] } };
  const input = { templateVersionId: 'version', definitionJson: JSON.stringify(definition) };
  sql.raw.prepare("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('template','tenant','rich_menu','Menu')").run();
  sql.raw.prepare("INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('version','tenant','template',1,?,'hash')").run(input.definitionJson);
  const objects = new Map<string, { bytes: Uint8Array; etag: string; size: number; httpMetadata: { contentType: string }; customMetadata?: Record<string, string> }>();
  for (const [i, p] of definition.richMenu.pages.entries()) objects.set(p.imageR2Key, { bytes: new Uint8Array([i + 1, 2, 3]), etag: `etag-${i}`, size: 3, httpMetadata: { contentType: 'image/png' } });
  const bucket = {
    head: vi.fn(async (key: string) => objects.get(key) ?? null),
    get: vi.fn(async (key: string, options?: R2GetOptions) => { const o = objects.get(key); if (!o) return null; if ((options?.onlyIf as R2Conditional)?.etagMatches !== o.etag) return o; return { ...o, body: true, arrayBuffer: async () => o.bytes.slice().buffer }; }),
    put: vi.fn(async (key: string, bytes: Uint8Array, options: R2PutOptions) => { if (objects.has(key)) return null; const o = { bytes: bytes.slice(), etag: key, size: bytes.length, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata as { contentType: string } }; objects.set(key, o); return o; }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
  };
  const options = { db: sql.db, bucket: bucket as unknown as R2Bucket, authority: { tenantId: 'tenant', actorId: 'staff', role: 'owner', readOnly: false, accountScoped: false } as const, input, resolveReference: async (r: { kind: string }, account: string) => `${r.kind}-${account}` };
  const adapter = createRichMenuHqTemplateAdapter(options);
  const batch = async (statements: readonly HqTemplateStatement[]) => { await sql.db.batch(statements.map(s => sql.db.prepare(s.sql).bind(...s.bindings))); };
  async function plan(account = 'a', override: Partial<HqTemplateAdapterContext> = {}) {
    const c: HqTemplateAdapterContext = { tenantId: 'tenant', targetAccountId: account, preflightId: `preflight-${account}`, idempotencyFingerprint: 'fingerprint', mode: 'create', snapshotToken: await adapter.snapshot(account), resolutions: [{ sourceId: 'menu', itemKind: 'rich_menu', mode: 'create' }], ...override };
    const extracted = await adapter.extractReferences(input); if (extracted.kind !== 'OK') throw new Error();
    const refs = await adapter.verifyReferences(c, extracted.value); if (refs.kind !== 'OK') throw new Error();
    const map = await adapter.buildIdMap(c, refs.value, []); if (map.kind !== 'OK') throw new Error();
    const result = await adapter.buildCommitPlan(c, input, map.value); if (result.kind !== 'OK') throw new Error();
    return result.value;
  }
  const execute = (p: HqTemplateStoreAtomicCommitPlan, commit = batch, reconcile = async () => 'not_committed' as const) => executeRichMenuHqPlan(p, { bucket: options.bucket, commit, reconcile });
  return { ...sql, objects, bucket, options, adapter, definition, input, plan, batch, execute };
}

describe('rich-menu HQ store atomic adapter', () => {
  it('copies bytes into three independent account prefixes and remaps refs, switches, draft/null LINE IDs', async () => {
    const f = fixture();
    for (const account of ['a', 'b', 'c']) {
      const plan = await f.plan(account); expect(await f.execute(plan)).toBe('committed');
      const group = f.raw.prepare('SELECT * FROM rich_menu_groups WHERE account_id=?').get(account) as any;
      expect(group.status).toBe('draft');
      const pages = f.raw.prepare('SELECT * FROM rich_menu_pages WHERE group_id=? ORDER BY order_index').all(group.id) as any[];
      expect(pages).toHaveLength(2);
      for (const [i, page] of pages.entries()) { expect(page.line_richmenu_id).toBeNull(); expect(page.image_r2_key.startsWith(`rich-menus/${account}/`)).toBe(true); expect(f.objects.get(page.image_r2_key)?.bytes).toEqual(new Uint8Array([i + 1, 2, 3])); }
      const area = f.raw.prepare('SELECT * FROM rich_menu_areas WHERE page_id=?').get(pages[0].id) as any;
      expect(area.form_id).toBe(`form-${account}`); expect(JSON.parse(area.tag_ids)).toEqual([`tag-${account}`]); expect(JSON.parse(area.action_data)).toEqual({ scenarioId: `scenario-${account}` });
      const switchArea = f.raw.prepare('SELECT * FROM rich_menu_areas WHERE page_id=?').get(pages[1].id) as any;
      expect(JSON.parse(switchArea.action_data).targetPageId).toBe(pages[0].id);
    }
    expect(f.objects.size).toBe(8);
  });
  it('rejects another tenant and cross-account references', async () => {
    const f = fixture(); await expect(f.plan('outside')).rejects.toThrow('SCOPE_MISMATCH');
    const adapter = createRichMenuHqTemplateAdapter({ ...f.options, resolveReference: async r => `${r.kind}-outside` });
    await expect(adapter.snapshot('a')).rejects.toThrow('REFERENCE_SCOPE_MISMATCH');
    f.raw.prepare('INSERT INTO form_accounts VALUES (?,?,?)').run('form-a', 'b', 'now');
    await expect(f.adapter.snapshot('a')).rejects.toThrow('REFERENCE_SCOPE_MISMATCH');
  });
  it('rejects unauthorized staff, unowned source, unsafe image key and opaque postback', async () => {
    const f = fixture(); expect(() => createRichMenuHqTemplateAdapter({ ...f.options, authority: { ...f.options.authority, accountScoped: true } as any })).toThrow('FORBIDDEN');
    f.raw.prepare("UPDATE hq_template_versions SET definition_json='{}'").run(); await expect(f.plan()).rejects.toThrow('SCOPE_MISMATCH');
    f.definition.richMenu.pages[0].imageR2Key = 'hq-templates/other/image';
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('IMAGE_SCOPE');
    f.definition.richMenu.pages[0].imageR2Key = 'hq-templates/tenant/image1'; f.definition.richMenu.pages[0].areas[0].actionData = { data: 'scenario=source-scenario' };
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('INVALID_DEFINITION');
  });
  it.each(['updated_at', 'content_revision'])('guards reference %s changes between planning and atomic commit', async field => {
    const f = fixture(); const p = await f.plan();
    f.raw.prepare(`UPDATE forms SET ${field}=? WHERE id='form-a'`).run(field === 'updated_at' ? 'changed' : 2);
    await expect(f.execute(p)).rejects.toThrow('STORE_COMMIT_FAILED');
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]); expect(f.objects.size).toBe(2);
  });
  it('does not leave a menu or staged images when the second image fails', async () => {
    const f = fixture(); const p = await f.plan(); f.bucket.put.mockImplementationOnce(async (key, bytes, opts) => { const o = { bytes: bytes.slice(), etag: key, size: bytes.length, customMetadata: opts.customMetadata, httpMetadata: { contentType: 'image/png' } }; f.objects.set(key, o); return o; }).mockRejectedValueOnce(new Error('internal bucket error'));
    await expect(f.execute(p)).rejects.toThrow('IMAGE_STAGE_FAILED'); expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]); expect(f.objects.size).toBe(2);
  });
  it('preserves committed bytes after a lost DB acknowledgement and reuses owned stage on retry', async () => {
    const f = fixture(); const p = await f.plan();
    const execute = () => executeRichMenuHqPlan(p, { bucket: f.options.bucket, commit: async s => { await f.batch(s); throw new Error('response lost'); }, reconcile: async () => 'committed' });
    expect(await execute()).toBe('committed'); expect(await execute()).toBe('committed');
    expect(f.bucket.put).toHaveBeenCalledTimes(2); expect(f.bucket.delete).not.toHaveBeenCalled(); expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toHaveLength(1);
  });
  it('leaves unresolved image ownership for durable reconciliation instead of deleting after unknown DB outcome', async () => {
    const f = fixture(); const p = await f.plan();
    expect(await executeRichMenuHqPlan(p, { bucket: f.options.bucket, commit: async () => { throw new Error('unknown'); }, reconcile: async () => 'unknown' })).toBe('cleanup_pending');
    expect(f.objects.size).toBe(4); expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('does not delete another owner object during compensation', async () => {
    const f = fixture(); const p = await f.plan(); f.objects.set(p.stage[0].key, { bytes: new Uint8Array([7]), etag: 'foreign', size: 1, httpMetadata: { contentType: 'image/png' }, customMetadata: { ownerToken: 'foreign' } });
    await expect(f.execute(p)).rejects.toThrow('IMAGE_STAGE_FAILED'); expect(f.objects.get(p.stage[0].key)?.etag).toBe('foreign');
  });
  it('rejects published/leased overwrite; a draft overwrite preserves group ID and guards later child edits', async () => {
    const f = fixture(); await f.execute(await f.plan());
    const g = f.raw.prepare('SELECT * FROM rich_menu_groups').get() as any;
    const options = { mode: 'overwrite' as const, preflightId: 'overwrite', resolutions: [{ sourceId: 'menu', itemKind: 'rich_menu', mode: 'overwrite' as const, targetId: g.id, expectedRevision: g.updated_at }] };
    f.raw.prepare("UPDATE rich_menu_groups SET status='published'").run(); await expect(f.plan('a', options)).rejects.toThrow('OVERWRITE_FORBIDDEN');
    f.raw.prepare("UPDATE rich_menu_groups SET status='draft',publishing_owner='lease'").run(); await expect(f.plan('a', options)).rejects.toThrow('OVERWRITE_FORBIDDEN');
    f.raw.prepare('UPDATE rich_menu_groups SET publishing_owner=NULL').run(); const p = await f.plan('a', options);
    f.raw.prepare("UPDATE rich_menu_areas SET action_data='{}'").run(); await expect(f.execute(p)).rejects.toThrow('STORE_COMMIT_FAILED');
    const next = await f.plan('a', options); expect(await f.execute(next)).toBe('committed');
    expect((f.raw.prepare('SELECT * FROM rich_menu_groups').get() as any).id).toBe(g.id);
  });
  it('requires a duplicate decision and creates an alias without altering the original', async () => {
    const f = fixture(); await f.execute(await f.plan());
    const original = f.raw.prepare('SELECT * FROM rich_menu_groups').get();
    await expect(f.plan('a', { preflightId: 'second' })).rejects.toThrow('DUPLICATE_NAME');
    await expect(f.plan('a', { preflightId: 'second', resolutions: [] })).rejects.toThrow('RESOLUTION_REQUIRED');
    const alias = await f.plan('a', { preflightId: 'second', mode: 'alias', resolutions: [{ sourceId: 'menu', itemKind: 'rich_menu', mode: 'alias', aliasName: 'Menu (2)' }] });
    expect(await f.execute(alias)).toBe('committed');
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups WHERE name=?').get('Menu')).toEqual(original);
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toHaveLength(2);
  });
  it('rejects malformed compensation paths before any R2 or commit operation', async () => {
    const f = fixture(); const p = await f.plan();
    const commit = vi.fn(); const before = f.bucket.head.mock.calls.length;
    await expect(executeRichMenuHqPlan({ ...p, stage: [{ ...p.stage[0], key: `rich-menus/b/hq/${p.stage[0].ownerToken}/image` }] }, { bucket: f.options.bucket, commit, reconcile: async () => 'not_committed' })).rejects.toThrow('IMAGE_SCOPE_MISMATCH');
    expect(f.bucket.head.mock.calls).toHaveLength(before); expect(commit).not.toHaveBeenCalled(); expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('rolls back menu SQL when a later coordinator audit statement fails', async () => {
    const f = fixture(); const p = await f.plan();
    await expect(f.execute(p, statements => f.batch([...statements, { sql: "SELECT json('AUDIT_FAILED')", bindings: [] }]))).rejects.toThrow('STORE_COMMIT_FAILED');
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]); expect(f.objects.size).toBe(2);
  });
  it('rejects stale preflight media and target edits', async () => {
    const f = fixture(); const snapshotToken = await f.adapter.snapshot('a');
    f.objects.get('hq-templates/tenant/image1')!.etag = 'changed';
    await expect(f.plan('a', { snapshotToken })).rejects.toThrow('VERSION_CONFLICT');
  });
});
