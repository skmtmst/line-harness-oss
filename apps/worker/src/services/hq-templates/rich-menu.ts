import { RICH_MENU_ACTION_TYPE_BY_INTENT } from '@line-crm/shared';
import { resolveSwitcherActions, validateRichMenuGroupForPublish, type AreaInput } from '../../lib/rich-menu-publisher.js';
import { buildTapPostbackData } from '../../lib/rich-menu-tap.js';
import {
  unsupportedHqTemplateAdapter, requireHqTemplateAuthority, createHqTemplateSnapshotToken,
  type HqTemplateAdapter, type HqTemplateAdapterInput, type HqTemplateAdapterContext,
  type HqTemplateAuthority, type HqTemplateReference, type HqTemplateMatchedReference,
  type HqTemplateStatement, type HqTemplateSnapshotToken, type HqTemplateStoreAtomicCommitPlan,
} from './contract.js';

/** Registry remains fail-closed until the store coordinator binds DB, R2 and reference adapters. */
export const richMenuHqTemplateAdapter = unsupportedHqTemplateAdapter('rich_menu');

type RefKind = 'tag' | 'form' | 'scenario' | 'template';
interface Area {
  id: string; bounds: { x: number; y: number; width: number; height: number };
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
  actionData: Record<string, string>; intent?: 'url' | 'text' | 'form' | 'template' | 'switch'; label?: string;
  tagIds?: string[]; formId?: string; templateId?: string; scenarioId?: string;
}
interface Page { id: string; name: string; imageR2Key: string; areas: Area[] }
export interface RichMenuHqDefinition {
  schemaVersion: 1;
  richMenu: { id: string; name: string; chatBarText: string; size: 'large' | 'compact'; defaultPageId: string; pages: Page[] };
}
export interface RichMenuReferenceResolver {
  (reference: HqTemplateReference, targetAccountId: string): Promise<string | null>;
}
export interface RichMenuAdapterOptions {
  db: D1Database; bucket: Pick<R2Bucket, 'head' | 'get' | 'put' | 'delete'>;
  authority: HqTemplateAuthority;
  /** A factory is bound to one immutable version; never reuse it for another template. */
  input: HqTemplateAdapterInput;
  resolveReference: RichMenuReferenceResolver;
}
function fail(code: string): never { throw new Error(code); }
const ident = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : fail('INVALID_ID');
const text = (value: unknown, max = 200): string => typeof value === 'string' && value.trim() && value.length <= max ? value : fail('INVALID_DEFINITION');
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_DEFINITION');
}
async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
}
const referenceKey = (r: HqTemplateReference) => `${r.kind}:${r.sourceId}`;
function validateTextPostback(area: Area, targetAreaId: string): void {
  // Tag actions wrap the text in a URL-encoded postback. Its final data, not
  // just the visible text, must fit LINE's 300-character limit.
  if (area.intent === 'text' && area.tagIds?.length
    && buildTapPostbackData(targetAreaId, area.actionData.text).length > 300) fail('INVALID_ACTION');
}
function assertPublicUri(value: unknown): void {
  const decode = (raw: string): string => {
    let current = raw;
    for (let i = 0; i < 3; i++) {
      if (!/%[0-9a-f]{2}/i.test(current)) return current;
      try {
        const next = decodeURIComponent(current);
        if (next === current) return current;
        current = next;
      } catch { fail('INVALID_ACTION'); }
    }
    // Encoded account references must not survive the bounded inspection.
    if (/%[0-9a-f]{2}/i.test(current)) fail('OPAQUE_REFERENCE_UNSUPPORTED');
    return current;
  };
  let url: URL;
  try {
    url = new URL(String(value));
  } catch { fail('INVALID_ACTION'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_ACTION');
  const path = decode(url.pathname);
  const query = decode(url.search);
  const hash = decode(url.hash);
  const queryKeys = [...url.searchParams.keys()].map(decode);
  const referenceParameter = /^(?:form|template|scenario|tag|(?:line)?account)(?:s|ids?)?$/;
  const referencePath = /(?:^|\/)(?:forms?|templates?|scenarios?|tags?|accounts?)\//i;
  const referenceFragment = /(?:^|[?&#\/=])(?:forms?|templates?|scenarios?|tags?|accounts?)(?:[_-]?ids?)?[=\/]/i;
  const liff = /(?:^|\/\/)(?:liff|miniapp)\.line\.me(?:[./:?#]|$)/i;
  if (['liff.line.me', 'miniapp.line.me'].includes(url.hostname.replace(/\.$/, ''))
    || queryKeys.some(k => referenceParameter.test(k.replace(/[_-]/g, '').toLowerCase()) || k.toLowerCase() === 'liff.state')
    || [path, query, hash].some(part => referencePath.test(part) || referenceFragment.test(part) || liff.test(part))) fail('OPAQUE_REFERENCE_UNSUPPORTED');
}
export function parseRichMenuTemplateDefinition(input: HqTemplateAdapterInput, tenantId: string): RichMenuHqDefinition {
  if (input.definitionJson.length > 128_000) fail('DEFINITION_TOO_LARGE');
  const d: unknown = JSON.parse(input.definitionJson);
  keys(d, ['schemaVersion', 'richMenu']);
  if (d.schemaVersion !== 1) fail('INVALID_DEFINITION');
  const g = d.richMenu;
  keys(g, ['id', 'name', 'chatBarText', 'size', 'defaultPageId', 'pages']);
  ident(g.id); text(g.name); text(g.chatBarText, 14); ident(g.defaultPageId);
  if (g.size !== 'large' && g.size !== 'compact') fail('INVALID_DEFINITION');
  if (!Array.isArray(g.pages) || !g.pages.length || g.pages.length > 10) fail('INVALID_DEFINITION');
  const ids = new Set<string>([String(g.id)]);
  const addId = (id: unknown) => { const key = ident(id); if (ids.has(key)) fail('DUPLICATE_SOURCE_ID'); ids.add(key); };
  for (const p of g.pages as unknown[]) {
    keys(p, ['id', 'name', 'imageR2Key', 'areas']); addId(p.id); text(p.name);
    const imageKey = text(p.imageR2Key, 1024);
    if (!imageKey.startsWith(`hq-templates/${tenantId}/`) || imageKey.split('/').some(s => !s || s === '.' || s === '..') || /[%\\\u0000-\u001f]/.test(imageKey)) fail('IMAGE_SCOPE_MISMATCH');
    if (!Array.isArray(p.areas) || p.areas.length > 20) fail('INVALID_DEFINITION');
    for (const a of p.areas as unknown[]) {
      keys(a, ['id', 'bounds', 'actionType', 'actionData', 'intent', 'label', 'tagIds', 'formId', 'templateId', 'scenarioId']); addId(a.id);
      keys(a.bounds, ['x', 'y', 'width', 'height']);
      const b = a.bounds;
      for (const v of Object.values(b)) if (!Number.isInteger(v) || (v as number) < 0) fail('INVALID_BOUNDS');
      if (!(Number(b.width) > 0 && Number(b.height) > 0 && Number(b.x) + Number(b.width) <= 2500 && Number(b.y) + Number(b.height) <= (g.size === 'large' ? 1686 : 843))) fail('INVALID_BOUNDS');
      if (!['uri', 'message', 'postback', 'richmenuswitch'].includes(String(a.actionType))) fail('INVALID_ACTION');
      // The existing publisher/tap handler has no executable scenario action.
      // Never report a successful distribution that silently drops that behavior.
      if (a.scenarioId !== undefined) fail('UNSUPPORTED_SCENARIO_REFERENCE');
      if (a.intent !== undefined) {
        if (!['url', 'text', 'form', 'template', 'switch'].includes(String(a.intent))) fail('INVALID_ACTION');
        const expected = RICH_MENU_ACTION_TYPE_BY_INTENT[a.intent as keyof typeof RICH_MENU_ACTION_TYPE_BY_INTENT];
        if (a.actionType !== expected) fail('INVALID_ACTION');
      }
      // Opaque postback payloads may hide source account IDs. Only structured references are accepted.
      const allowed = a.intent === 'form' ? [] : a.actionType === 'richmenuswitch' ? ['targetPageId'] : a.actionType === 'uri' ? ['uri'] : a.actionType === 'message' ? ['text'] : [];
      keys(a.actionData, allowed);
      for (const v of Object.values(a.actionData)) text(v, 2000);
      if (a.actionType === 'uri' && a.intent !== 'form') assertPublicUri(a.actionData.uri);
      if (a.actionType === 'message' && !a.actionData.text) fail('INVALID_ACTION');
      if (a.actionType === 'richmenuswitch') ident(a.actionData.targetPageId);
      if (a.actionType === 'postback' && a.intent !== 'template') fail('OPAQUE_REFERENCE_UNSUPPORTED');
      if (a.label !== undefined) text(a.label);
      for (const key of ['formId', 'templateId']) if (a[key] !== undefined) ident(a[key]);
      if (a.intent === 'form' && !a.formId || a.intent === 'template' && !a.templateId) fail('MISSING_REFERENCE');
      if (a.formId !== undefined && a.intent !== 'form' || a.templateId !== undefined && a.intent !== 'template') fail('INVALID_REFERENCE');
      if (a.tagIds !== undefined && (!Array.isArray(a.tagIds) || a.tagIds.length > 30)) fail('INVALID_REFERENCE');
      for (const tag of (a.tagIds ?? []) as unknown[]) ident(tag);
      // Only these intents emit an area postback consumed by handleRichMenuTap.
      if ((a.tagIds as unknown[] | undefined)?.length && !['text', 'template'].includes(String(a.intent))) fail('UNSUPPORTED_TAG_ACTION');
    }
  }
  const definition = d as unknown as RichMenuHqDefinition;
  // buildIdMap generates 32-character IDs. Recheck the actual mapping at commit.
  for (const p of definition.richMenu.pages) for (const a of p.areas) validateTextPostback(a, '0'.repeat(32));
  const pageIds = new Set(definition.richMenu.pages.map(p => p.id));
  if (!pageIds.has(definition.richMenu.defaultPageId)) fail('INVALID_DEFAULT_PAGE');
  for (const p of definition.richMenu.pages) for (const a of p.areas) if (a.actionType === 'richmenuswitch' && !pageIds.has(a.actionData.targetPageId)) fail('INVALID_SWITCH_TARGET');
  // Reuse the same action validator as publication (no LINE/R2 calls). The target
  // account's actual LIFF URL remains a prerequisite of the later publish flow.
  const pages = definition.richMenu.pages.map((p, orderIndex) => ({ ...p, orderIndex, imageContentType: null, lineRichMenuId: null, areas: p.areas as AreaInput[] }));
  try {
    validateRichMenuGroupForPublish({ id: definition.richMenu.id, size: definition.richMenu.size, chatBarText: definition.richMenu.chatBarText, isDefaultForAll: false, formBaseUrl: 'https://example.invalid/', pages: resolveSwitcherActions(pages, definition.richMenu.id) });
  } catch { fail('INVALID_ACTION'); }
  return definition;
}

function references(d: RichMenuHqDefinition): HqTemplateReference[] {
  const result = new Map<string, HqTemplateReference>();
  for (const page of d.richMenu.pages) for (const a of page.areas) {
    const refs: [RefKind, string | undefined][] = [['form', a.formId], ['template', a.templateId], ['scenario', a.scenarioId], ...(a.tagIds ?? []).map(id => ['tag', id] as [RefKind, string])];
    for (const [kind, sourceId] of refs) if (sourceId) result.set(`${kind}:${sourceId}`, { kind, sourceId });
  }
  return [...result.values()].sort((a, b) => referenceKey(a).localeCompare(referenceKey(b)));
}
const jsonRows = (columns: string[], from: string, where: string, order = 'id') => `(SELECT json_group_array(json_array(${columns.join(',')})) FROM (SELECT * FROM ${from} WHERE ${where} ORDER BY ${order}))`;
const GROUP_COLUMNS = ['id', 'name', 'chat_bar_text', 'size', 'default_page_id', 'status', 'publishing_at', 'publishing_owner', 'publishing_expires_at', 'publishing_generation', 'updated_at', 'folder_id', 'targeting_condition', 'targeting_enabled', 'is_default_for_all', 'targeting_priority', 'display_order', 'created_at'];
const PAGE_COLUMNS = ['id', 'group_id', 'order_index', 'name', 'image_r2_key', 'line_richmenu_id', 'updated_at', 'alias_id', 'image_content_type', 'created_at'];
const AREA_COLUMNS = ['id', 'page_id', 'action_type', 'action_data', 'intent', 'tag_ids', 'form_id', 'template_id', 'tracked_link_id', 'bounds_x', 'bounds_y', 'bounds_width', 'bounds_height', 'updated_at', 'label', 'score_change', 'created_at'];

/** Bound adapter. snapshot() is persisted by the preflight coordinator, not recomputed on apply. */
export function createRichMenuHqTemplateAdapter(options: RichMenuAdapterOptions): HqTemplateAdapter & {
  snapshot(targetAccountId: string): Promise<HqTemplateSnapshotToken>;
} {
  const { db, bucket, resolveReference } = options;
  const authority = { ...options.authority };
  const input = { ...options.input };
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED') fail('FORBIDDEN');
  ident(authority.tenantId); ident(input.templateVersionId);
  const d = parseRichMenuTemplateDefinition(input, authority.tenantId); const g = d.richMenu; const refs = references(d);
  // D1 allows 100 bound parameters per statement. The atomic snapshot guard
  // needs the seven root bindings, reference bindings, and one expected snapshot.
  if (8 + refs.reduce((count, ref) => count + (ref.kind === 'form' ? 3 : 2), 0) > 100) fail('UNSUPPORTED_REFERENCE_LIMIT');
  const assertContext = (c: Pick<HqTemplateAdapterContext, 'tenantId' | 'targetAccountId'>) => {
    if (c.tenantId !== authority.tenantId) fail('FORBIDDEN'); ident(c.targetAccountId);
  };
  async function targetRefs(accountId: string): Promise<HqTemplateMatchedReference[]> {
    return Promise.all(refs.map(async r => {
      const targetId = await resolveReference(r, accountId);
      if (!targetId) fail('REFERENCE_UNRESOLVED');
      return { ...r, targetId: ident(targetId) };
    }));
  }
  async function capture(accountId: string) {
    ident(accountId);
    const matched = await targetRefs(accountId);
    const parts = [jsonRows(['id', 'tenant_id', 'revision', 'is_active', 'archived_at'], 'line_accounts', 'id = ? AND tenant_id = ? AND is_active = 1 AND archived_at IS NULL')];
    const bindings: (string | number | null)[] = [accountId, authority.tenantId];
    parts.push(jsonRows(['id', 'definition_json'], 'hq_template_versions', "id=? AND tenant_id=? AND EXISTS (SELECT 1 FROM hq_templates t WHERE t.id=hq_template_versions.template_id AND t.tenant_id=hq_template_versions.tenant_id AND t.template_type='rich_menu' AND t.archived_at IS NULL)"));
    bindings.push(input.templateVersionId, authority.tenantId);
    parts.push(jsonRows(GROUP_COLUMNS, 'rich_menu_groups', 'account_id=?')); bindings.push(accountId);
    parts.push(jsonRows(PAGE_COLUMNS, 'rich_menu_pages', 'group_id IN (SELECT id FROM rich_menu_groups WHERE account_id=?)')); bindings.push(accountId);
    parts.push(jsonRows(AREA_COLUMNS, 'rich_menu_areas', 'page_id IN (SELECT p.id FROM rich_menu_pages p JOIN rich_menu_groups g ON g.id=p.group_id WHERE g.account_id=?)')); bindings.push(accountId);
    for (const r of matched) {
      if (r.kind === 'form') {
        parts.push(jsonRows(['id', 'content_revision', 'updated_at'], 'forms', 'id=? AND EXISTS (SELECT 1 FROM form_accounts WHERE form_id=forms.id AND line_account_id=?) AND NOT EXISTS (SELECT 1 FROM form_accounts WHERE form_id=forms.id AND line_account_id<>?)'));
        bindings.push(r.targetId, accountId, accountId);
      } else {
        const table = { tag: 'tags', scenario: 'scenarios', template: 'templates' }[r.kind as Exclude<RefKind, 'form'>];
        if (!table) fail('INVALID_REFERENCE');
        parts.push(jsonRows(['id', 'updated_at', ...(r.kind === 'tag' ? ['version'] : r.kind === 'template' ? ['draft_revision'] : [])], table, 'id=? AND line_account_id=?'));
        bindings.push(r.targetId, accountId);
      }
    }
    const sql = `SELECT json_array(${parts.join(',')}) AS snapshot`;
    const row = await db.prepare(sql).bind(...bindings).first<{ snapshot: string }>();
    if (!row) fail('VERSION_CONFLICT');
    const values = JSON.parse(row.snapshot) as unknown[][][];
    if (values[0].length !== 1 || values[1].length !== 1 || values[1][0][1] !== input.definitionJson) fail('SOURCE_OR_TARGET_SCOPE_MISMATCH');
    if (values.slice(5).some(v => v.length !== 1)) fail('REFERENCE_SCOPE_MISMATCH');
    const media = await Promise.all(g.pages.map(async p => {
      const obj = await bucket.head(p.imageR2Key);
      if (!obj || obj.size < 1 || obj.size > 1024 * 1024 || !['image/png', 'image/jpeg'].includes(obj.httpMetadata?.contentType ?? '')) fail('INVALID_IMAGE');
      return { key: p.imageR2Key, etag: obj.etag, size: obj.size, contentType: obj.httpMetadata!.contentType! };
    }));
    const token = await createHqTemplateSnapshotToken({ schemaVersion: 1, rootHash: await digest(row.snapshot), referenceHash: await digest(JSON.stringify(matched)), childHash: await digest(input.definitionJson), mediaKeyHash: await digest(JSON.stringify(media)) }, digest);
    return { sql, bindings, raw: row.snapshot, token, matched, media };
  }
  return {
    type: 'rich_menu',
    snapshot: async accountId => (await capture(accountId)).token,
    extractReferences: async candidate => {
      if (candidate.templateVersionId !== input.templateVersionId || candidate.definitionJson !== input.definitionJson) fail('VERSION_CONFLICT');
      return { kind: 'OK', value: refs };
    },
    verifyReferences: async (c, requested) => {
      assertContext(c);
      if (JSON.stringify(requested) !== JSON.stringify(refs)) fail('REFERENCE_MISMATCH');
      const s = await capture(c.targetAccountId); if (s.token !== c.snapshotToken) fail('VERSION_CONFLICT');
      return { kind: 'OK', value: s.matched };
    },
    detectDuplicates: async c => {
      assertContext(c);
      const rows = await db.prepare('SELECT id FROM rich_menu_groups WHERE account_id=? AND name=? ORDER BY id').bind(c.targetAccountId, g.name).all<{ id: string }>();
      return { kind: 'OK', value: rows.results.map(r => ({ sourceId: g.id, targetId: r.id, reason: 'same_name' })) };
    },
    buildIdMap: async (c, matched) => {
      assertContext(c);
      const actual = await targetRefs(c.targetAccountId);
      if (JSON.stringify(matched) !== JSON.stringify(actual)) fail('REFERENCE_MISMATCH');
      const entries = await Promise.all([g.id, ...g.pages.flatMap(p => [p.id, ...p.areas.map(a => a.id)])].map(async id => [id, (await digest(JSON.stringify([authority.tenantId, c.targetAccountId, c.preflightId, input.templateVersionId, id]))).slice(0, 32)]));
      return { kind: 'OK', value: Object.fromEntries([...entries, ...actual.map(r => [referenceKey(r), r.targetId])]) };
    },
    buildCommitPlan: async (c, candidate, idMap) => {
      assertContext(c); ident(c.preflightId); text(c.idempotencyFingerprint, 256);
      if (!['create', 'overwrite', 'alias'].includes(c.mode)) fail('INVALID_MODE');
      if (candidate.templateVersionId !== input.templateVersionId || candidate.definitionJson !== input.definitionJson) fail('VERSION_CONFLICT');
      const s = await capture(c.targetAccountId); if (s.token !== c.snapshotToken) fail('VERSION_CONFLICT');
      for (const r of s.matched) if (idMap[referenceKey(r)] !== r.targetId) fail('REFERENCE_MISMATCH');
      const resolve = (id: string) => ident(idMap[id]);
      for (const p of g.pages) for (const a of p.areas) validateTextPostback(a, resolve(a.id));
      const decisions = c.resolutions.filter(r => r.sourceId === g.id && r.itemKind === 'rich_menu');
      if (decisions.length !== 1 || c.resolutions.length !== 1 || decisions[0].mode !== c.mode) fail('RESOLUTION_REQUIRED');
      const choice = decisions[0];
      const groupId = c.mode === 'overwrite' ? ident(choice.targetId) : resolve(g.id);
      const target = await db.prepare('SELECT * FROM rich_menu_groups WHERE id=? AND account_id=?').bind(groupId, c.targetAccountId).first<Record<string, unknown>>();
      if (c.mode === 'overwrite' && (!target || target.status !== 'draft' || target.name !== g.name || target.publishing_owner || target.publishing_at || target.publishing_expires_at || target.updated_at !== choice.expectedRevision)) fail('OVERWRITE_FORBIDDEN_OR_CONFLICT');
      if (c.mode === 'overwrite' && await db.prepare('SELECT id FROM rich_menu_pages WHERE group_id=? AND line_richmenu_id IS NOT NULL LIMIT 1').bind(groupId).first()) fail('OVERWRITE_FORBIDDEN_OR_CONFLICT');
      if (c.mode !== 'overwrite' && target) fail('VERSION_CONFLICT');
      const name = c.mode === 'alias' ? text(choice.aliasName) : g.name;
      if (c.mode === 'alias' && (!name.startsWith(`${g.name} (`) || !/^[2-9][0-9]*\)$|^1[0-9]+\)$/.test(name.slice(g.name.length + 2)))) fail('ALIAS_REQUIRED');
      const nameMatch = await db.prepare('SELECT id FROM rich_menu_groups WHERE account_id=? AND name=? AND id<>?').bind(c.targetAccountId, name, groupId).first();
      if (nameMatch) fail('DUPLICATE_NAME');
      const ownerToken = await digest(JSON.stringify([c.tenantId, c.targetAccountId, c.preflightId, c.idempotencyFingerprint]));
      const stage = await Promise.all(g.pages.map(async (p, i) => {
        const obj = await bucket.get(p.imageR2Key, { onlyIf: { etagMatches: s.media[i].etag } });
        if (!obj || !('body' in obj)) fail('IMAGE_CHANGED');
        const bytes = new Uint8Array(await obj.arrayBuffer()); if (bytes.length !== s.media[i].size) fail('IMAGE_CHANGED');
        return { key: `rich-menus/${c.targetAccountId}/hq/${ownerToken}/${resolve(p.id)}`, ownerToken, bytes, contentType: s.media[i].contentType };
      }));
      const dbCommit: HqTemplateStatement[] = [{ sql: `SELECT json(CASE WHEN (${s.sql}) = ? THEN '{}' ELSE 'VERSION_CONFLICT' END)`, bindings: [...s.bindings, s.raw] }];
      const add = (sql: string, ...bindings: (string | number | null)[]) => dbCommit.push({ sql, bindings });
      if (c.mode === 'overwrite') {
        // Explicit child deletion also works with the application's current FK-off test fixture.
        add('DELETE FROM rich_menu_areas WHERE page_id IN (SELECT id FROM rich_menu_pages WHERE group_id=?)', groupId);
        add('DELETE FROM rich_menu_pages WHERE group_id=?', groupId);
        add("UPDATE rich_menu_groups SET name=?, chat_bar_text=?, size=?, default_page_id=?, status='draft', is_default_for_all=0, targeting_enabled=0, targeting_condition=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND account_id=?", name, g.chatBarText, g.size, resolve(g.defaultPageId), groupId, c.targetAccountId);
      } else add('INSERT INTO rich_menu_groups (id,account_id,name,chat_bar_text,size,default_page_id,status) VALUES (?,?,?,?,?,?,\'draft\')', groupId, c.targetAccountId, name, g.chatBarText, g.size, resolve(g.defaultPageId));
      g.pages.forEach((p, i) => {
        add('INSERT INTO rich_menu_pages (id,group_id,order_index,name,alias_id,line_richmenu_id,image_r2_key,image_content_type) VALUES (?,?,?,?,?,NULL,?,?)', resolve(p.id), groupId, i, p.name, `lhx-${groupId.slice(0, 8)}-${i}`, stage[i].key, stage[i].contentType);
        for (const a of p.areas) {
          const ref = (kind: RefKind, id?: string) => id ? ident(idMap[`${kind}:${id}`]) : null;
          const data: Record<string, string | null> = { ...a.actionData, ...(a.scenarioId ? { scenarioId: ref('scenario', a.scenarioId) } : {}) };
          if (a.actionType === 'richmenuswitch') data.targetPageId = resolve(a.actionData.targetPageId);
          add('INSERT INTO rich_menu_areas (id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent,label,tag_ids,form_id,template_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', resolve(a.id), resolve(p.id), a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height, a.actionType, JSON.stringify(data), a.intent ?? null, a.label ?? null, JSON.stringify((a.tagIds ?? []).map(id => ref('tag', id))), ref('form', a.formId), ref('template', a.templateId));
        }
      });
      const owned = stage.map(({ key, ownerToken }) => ({ key, ownerToken }));
      return { kind: 'OK', value: { tenantId: c.tenantId, targetAccountId: c.targetAccountId, preflightId: c.preflightId, idempotencyFingerprint: c.idempotencyFingerprint, snapshotToken: c.snapshotToken, mode: c.mode, resolutions: c.resolutions, stage, dbCommit, compensateOnDbFailure: owned, reconcile: owned } };
    },
  };
}

/** Caller must hold the store lease through stage/commit/reconciliation, including retries.
 * commit runs the plan AND the coordinator's preflight claim/result/audit in one D1 batch.
 * uncertain outcomes never delete an image that a committed menu could reference.
 */
export async function executeRichMenuHqPlan(
  plan: HqTemplateStoreAtomicCommitPlan,
  dependencies: {
    bucket: Pick<R2Bucket, 'head' | 'put' | 'delete'>;
    commit: (statements: readonly HqTemplateStatement[]) => Promise<void>;
    reconcile: () => Promise<'committed' | 'not_committed' | 'unknown'>;
  },
): Promise<'committed' | 'cleanup_pending'> {
  const { bucket, commit, reconcile } = dependencies;
  for (const obj of plan.stage) {
    if (!/^[a-f0-9]{64}$/.test(obj.ownerToken) || !new RegExp(`^rich-menus/${ident(plan.targetAccountId)}/hq/${obj.ownerToken}/[a-f0-9]{32}$`).test(obj.key)) fail('IMAGE_SCOPE_MISMATCH');
  }
  let commitStarted = false;
  try {
    for (const obj of plan.stage) {
      if (!obj.key.startsWith(`rich-menus/${ident(plan.targetAccountId)}/hq/${obj.ownerToken}/`) || !/^[a-f0-9]{64}$/.test(obj.ownerToken)) fail('IMAGE_SCOPE_MISMATCH');
      const contentHash = await digest(obj.bytes);
      const existing = await bucket.head(obj.key);
      if (existing) {
        if (existing.customMetadata?.ownerToken !== obj.ownerToken || existing.customMetadata?.contentHash !== contentHash) fail('IMAGE_OWNER_CONFLICT');
        continue;
      }
      const written = await bucket.put(obj.key, obj.bytes, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { ownerToken: obj.ownerToken, contentHash }, httpMetadata: { contentType: obj.contentType } });
      if (!written) fail('IMAGE_OWNER_CONFLICT');
    }
    commitStarted = true;
    await commit(plan.dbCommit);
    return 'committed';
  } catch (error) {
    // A retry may encounter images written before a successful but unacknowledged commit.
    const outcome = await reconcile().catch(() => 'unknown' as const);
    if (outcome === 'committed') return 'committed';
    if (outcome === 'unknown') return 'cleanup_pending';
    let cleanupFailed = false;
    for (const obj of plan.stage) {
      try {
        const current = await bucket.head(obj.key);
        if (current?.customMetadata?.ownerToken === obj.ownerToken) await bucket.delete(obj.key);
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) return 'cleanup_pending';
    // Do not expose DB/R2 messages, which may contain internal keys or SQL bindings.
    fail(commitStarted ? 'STORE_COMMIT_FAILED' : 'IMAGE_STAGE_FAILED');
  }
}
