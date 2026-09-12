import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { createRichMenuHqTemplateAdapter, executeRichMenuHqPlan, type RichMenuHqDefinition } from './rich-menu.js';
import { createRichMenuShells, type GroupInput, type LineRichMenuClient } from '../../lib/rich-menu-publisher.js';
import type { HqTemplateAdapterContext, HqTemplateStatement, HqTemplateStoreAtomicCommitPlan } from './contract.js';

const resources: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const r of resources.splice(0)) r.raw.close(); });
function fixture(messageText = 'ご案内') {
  const sql = createTestD1({ foreignKeys: true }); resources.push(sql);
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant','HQ'),('other','Other');`);
  for (const account of ['a', 'b', 'c', 'outside']) {
    sql.raw.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES (?,?,?,?,?,?)').run(account, account, account, 'test-only', 'test-only', account === 'outside' ? 'other' : 'tenant');
    sql.raw.prepare('INSERT INTO tags(id,name,line_account_id) VALUES (?,?,?)').run(`tag-${account}`, `Tag-${account}`, account);
    sql.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES (?,?,'text','fixture',?)").run(`template-${account}`, 'Template', account);
    sql.raw.prepare('INSERT INTO forms(id,name) VALUES (?,?)').run(`form-${account}`, 'Form');
    sql.raw.prepare('INSERT INTO form_accounts VALUES (?,?,?)').run(`form-${account}`, account, 'now');
    sql.raw.prepare("INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES (?,?,'manual',?)").run(`scenario-${account}`, 'Scenario', account);
  }
  const definition: RichMenuHqDefinition = { schemaVersion: 1, richMenu: { id: 'menu', name: 'Menu', chatBarText: '開く', size: 'large', defaultPageId: 'p1', pages: [
    { id: 'p1', name: 'One', imageR2Key: 'hq-templates/tenant/image1', areas: [{ id: 'ar1', bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'uri', actionData: {}, intent: 'form', formId: 'source-form' }, { id: 'ar3', bounds: { x: 100, y: 0, width: 100, height: 100 }, actionType: 'message', actionData: { text: messageText }, intent: 'text', tagIds: ['source-tag'] }, { id: 'ar4', bounds: { x: 200, y: 0, width: 100, height: 100 }, actionType: 'postback', actionData: {}, intent: 'template', templateId: 'source-template' }] },
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
      expect(area.form_id).toBe(`form-${account}`); expect(JSON.parse(area.action_data)).toEqual({});
      expect((f.raw.prepare("SELECT tag_ids FROM rich_menu_areas WHERE page_id=? AND intent='text'").get(pages[0].id) as any).tag_ids).toBe(JSON.stringify([`tag-${account}`]));
      expect((f.raw.prepare("SELECT template_id FROM rich_menu_areas WHERE page_id=? AND intent='template'").get(pages[0].id) as any).template_id).toBe(`template-${account}`);
      const switchArea = f.raw.prepare('SELECT * FROM rich_menu_areas WHERE page_id=?').get(pages[1].id) as any;
      expect(JSON.parse(switchArea.action_data).targetPageId).toBe(pages[0].id);
    }
    expect(f.objects.size).toBe(8);
  });
  it.each([
    'https://example.invalid/liff?form=source-form',
    'https://example.invalid/?template_id=source-template',
    'https://example.invalid/?scenarioId=source-scenario',
    'https://example.invalid/?tag=source-tag',
    'https://example.invalid/?line_account_id=source-account',
    'https://example.invalid/forms/source-form',
    'https://example.invalid/#/forms/source-form',
    'https://example.invalid/#?form=source-form',
    'https://liff.line.me/source-liff',
    'https://example.invalid/?next=https%3A%2F%2Fliff.line.me%2Fsource',
    'https://example.invalid/?next=%2Fforms%2Fsource',
    'https://example.invalid/%2566orms/source',
    'https://example.invalid/?next=https%253A%252F%252Fliff.line.me%252Fsource',
  ])('rejects opaque source references before DB/R2 work: %s', uri => {
    const f = fixture();
    const area = f.definition.richMenu.pages[0].areas[0];
    Object.assign(area, { actionType: 'uri', actionData: { uri }, intent: 'url' }); delete area.formId;
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('OPAQUE_REFERENCE_UNSUPPORTED');
    expect(f.bucket.head).not.toHaveBeenCalled(); expect(f.bucket.put).not.toHaveBeenCalled();
  });
  it('explicitly rejects unexecutable scenario references instead of marking them copied', () => {
    const f = fixture(); f.definition.richMenu.pages[0].areas[0].scenarioId = 'source-scenario';
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('UNSUPPORTED_SCENARIO_REFERENCE');
    expect(f.bucket.head).not.toHaveBeenCalled(); expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]);
  });
  it.each([
    { actionType: 'message', actionData: { text: 'switch' }, intent: 'switch' },
    { actionType: 'postback', actionData: {}, intent: 'form', formId: 'source-form' },
    { actionType: 'uri', actionData: { uri: 'https://example.invalid/' }, intent: 'text' },
    { actionType: 'message', actionData: { text: 'x'.repeat(301) }, intent: 'text' },
    { actionType: 'uri', actionData: { uri: `https://example.invalid/${'x'.repeat(1000)}` }, intent: 'url' },
  ])('rejects an action the existing publisher cannot publish: %j', replacement => {
    const f = fixture();
    f.definition.richMenu.pages[0].areas[0] = { id: 'ar1', bounds: { x: 0, y: 0, width: 100, height: 100 }, ...replacement } as any;
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('INVALID_ACTION');
    expect(f.bucket.head).not.toHaveBeenCalled();
  });
  it.each(['form', 'url', undefined])('rejects tag side effects for an intent that never emits a tap: %s', intent => {
    const f = fixture();
    const area = f.definition.richMenu.pages[0].areas[0];
    area.tagIds = ['source-tag'];
    if (intent !== 'form') { delete area.formId; Object.assign(area, { intent, actionType: 'uri', actionData: { uri: 'https://example.invalid/' } }); }
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('UNSUPPORTED_TAG_ACTION');
  });
  it.each([
    { name: 'normal', messageText: 'ご案内', postbackLength: 66 },
    { name: 'Japanese boundary', messageText: 'あ'.repeat(29), postbackLength: 300 },
    { name: 'ASCII boundary', messageText: 'x'.repeat(261), postbackLength: 300 },
  ])('publishes persisted $name actions through only fake LINE/R2 clients', async ({ messageText, postbackLength }) => {
    const f = fixture(messageText); await f.execute(await f.plan('a'));
    const row = f.raw.prepare('SELECT * FROM rich_menu_groups').get() as any;
    const pages = (f.raw.prepare('SELECT * FROM rich_menu_pages WHERE group_id=? ORDER BY order_index').all(row.id) as any[]).map(p => ({
      id: p.id, orderIndex: p.order_index, name: p.name, imageR2Key: p.image_r2_key, imageContentType: p.image_content_type, lineRichMenuId: p.line_richmenu_id,
      areas: (f.raw.prepare('SELECT * FROM rich_menu_areas WHERE page_id=? ORDER BY rowid').all(p.id) as any[]).map(a => ({ id: a.id, bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height }, actionType: a.action_type, actionData: JSON.parse(a.action_data), intent: a.intent, formId: a.form_id, templateId: a.template_id, tagIds: JSON.parse(a.tag_ids) })),
    }));
    const group: GroupInput = { id: row.id, size: row.size, chatBarText: row.chat_bar_text, isDefaultForAll: false, formBaseUrl: 'https://liff.line.me/fixture-a', pages };
    const createRichMenu = vi.fn(async (_payload: unknown) => ({ richMenuId: `fake-${crypto.randomUUID()}` }));
    const line = { createRichMenu, uploadRichMenuImage: vi.fn(), deleteRichMenu: vi.fn() } as unknown as LineRichMenuClient;
    await createRichMenuShells(group, line, { get: async key => ({ body: f.objects.get(key)!.bytes }) });
    const payloads = createRichMenu.mock.calls.map(c => c[0] as any);
    expect(payloads[0].areas[0].action).toEqual({ type: 'uri', uri: 'https://liff.line.me/fixture-a?form=form-a' });
    expect(payloads[0].areas[1].action).toMatchObject({ type: 'postback', displayText: messageText });
    expect(payloads[0].areas[1].action.data.length).toBe(postbackLength);
    expect(payloads[0].areas[1].action.data).toContain(pages[0].areas[1].id);
    expect(payloads[0].areas[2].action).toMatchObject({ type: 'postback' });
    expect(payloads[0].areas[2].action.data).toContain(pages[0].areas[2].id);
    expect(payloads[1].areas[0].action).toMatchObject({ type: 'richmenuswitch', richMenuAliasId: `lhx-${row.id.slice(0, 8)}-0` });
    expect(JSON.stringify(payloads)).not.toMatch(/source-(form|template|tag|scenario)/);
    // Publishing was simulated, so the distribution still has no actual LINE ID.
    expect(f.raw.prepare('SELECT line_richmenu_id FROM rich_menu_pages').all()).toEqual([{ line_richmenu_id: null }, { line_richmenu_id: null }]);
  });
  it.each(['あ'.repeat(30), 'x'.repeat(262), '😀'.repeat(22)])('rejects encoded text postbacks over 300 characters before R2 access: %s', messageText => {
    const f = fixture();
    f.definition.richMenu.pages[0].areas[1].actionData.text = messageText;
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).toThrow('INVALID_ACTION');
    expect(f.bucket.head).not.toHaveBeenCalled(); expect(f.bucket.get).not.toHaveBeenCalled(); expect(f.bucket.put).not.toHaveBeenCalled();
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]);
  });
  it('keeps the full 300-character message limit when no tag postback is emitted', () => {
    const f = fixture();
    const area = f.definition.richMenu.pages[0].areas[1];
    area.actionData.text = 'あ'.repeat(300); area.tagIds = [];
    expect(() => createRichMenuHqTemplateAdapter({ ...f.options, input: { ...f.input, definitionJson: JSON.stringify(f.definition) } })).not.toThrow();
  });
  it('rechecks the final mapped area ID before reading or staging image bytes', async () => {
    const f = fixture('あ'.repeat(29));
    const c: HqTemplateAdapterContext = { tenantId: 'tenant', targetAccountId: 'a', preflightId: 'preflight-a', idempotencyFingerprint: 'fingerprint', mode: 'create', snapshotToken: await f.adapter.snapshot('a'), resolutions: [{ sourceId: 'menu', itemKind: 'rich_menu', mode: 'create' }] };
    const extracted = await f.adapter.extractReferences(f.input); if (extracted.kind !== 'OK') throw new Error();
    const refs = await f.adapter.verifyReferences(c, extracted.value); if (refs.kind !== 'OK') throw new Error();
    const map = await f.adapter.buildIdMap(c, refs.value, []); if (map.kind !== 'OK') throw new Error();
    await expect(f.adapter.buildCommitPlan(c, f.input, { ...map.value, ar3: 'a'.repeat(128) })).rejects.toThrow('INVALID_ACTION');
    expect(f.bucket.get).not.toHaveBeenCalled(); expect(f.bucket.put).not.toHaveBeenCalled();
    expect(f.raw.prepare('SELECT * FROM rich_menu_groups').all()).toEqual([]);
  });
  it('rejects more than 100 snapshot guard bindings before resolving refs or querying DB', () => {
    const f = fixture(), resolveReference = vi.fn();
    const definitionWithTags = (count: number) => ({ ...f.definition, richMenu: { ...f.definition.richMenu, pages: [{ ...f.definition.richMenu.pages[0], areas: [
      { id: 'many-1', bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'message', actionData: { text: '案内' }, intent: 'text', tagIds: Array.from({ length: Math.min(count, 30) }, (_, i) => `source-${i}`) },
      { id: 'many-2', bounds: { x: 100, y: 0, width: 100, height: 100 }, actionType: 'message', actionData: { text: '案内' }, intent: 'text', tagIds: Array.from({ length: Math.max(0, count - 30) }, (_, i) => `source-${i + 30}`) },
    ] }] } });
    const build = (count: number) => createRichMenuHqTemplateAdapter({ ...f.options, resolveReference, input: { ...f.input, definitionJson: JSON.stringify(definitionWithTags(count)) } });
    expect(() => build(46)).not.toThrow(); // 7 root + 92 refs + 1 expected = 100.
    expect(() => build(47)).toThrow('UNSUPPORTED_REFERENCE_LIMIT');
    expect(resolveReference).not.toHaveBeenCalled(); expect(f.bucket.head).not.toHaveBeenCalled();
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
