import { normalizeScopedTagName, type HqTemplateStatement } from '@line-crm/db';
import { unsupportedHqTemplateAdapter, type HqTemplateResolution, type HqTemplateAdapter, type HqTemplateAuthority } from './contract.js';

export class HqTemplateError extends Error {
  constructor(public code: string, public status: 400 | 403 | 404 | 409 | 422 | 500 = 400) { super(code); }
}
export type TagDefinition = {
  schemaVersion: 1;
  tag: { name: string; color: string; description: string | null; folderId: string | null };
  folders: { id: string; name: string; parentId: string | null; color: string | null }[];
};
export type PreflightItem = { sourceId: string; itemKind: 'tag' | 'folder'; name: string; targetId: string | null; expectedRevision: string | null; duplicate: boolean; allowedModes: ('create' | 'overwrite' | 'alias')[] };
type Snapshot = {
  tags: { id: string; name: string; status: string; updated_at: string | null; version: number }[];
  folders: { id: string; name: string; parent_id: string | null; updated_at: string }[];
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HqTemplateError('INVALID_DEFINITION');
  return v as Record<string, unknown>;
}
export function boundedText(v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HqTemplateError('INVALID_DEFINITION');
  return v.trim();
}
function color(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new HqTemplateError('INVALID_DEFINITION');
  return v;
}
export function parseTagDefinition(v: unknown): TagDefinition {
  const root = object(v), tag = object(root.tag);
  if (root.schemaVersion !== 1 || !Array.isArray(root.folders) || root.folders.length > 8) throw new HqTemplateError('INVALID_DEFINITION');
  const folders = root.folders.map(v => {
    const f = object(v);
    return { id: boundedText(f.id, 80), name: boundedText(f.name), parentId: f.parentId == null ? null : boundedText(f.parentId, 80), color: color(f.color) };
  });
  if (new Set(folders.map(f => f.id)).size !== folders.length) throw new HqTemplateError('INVALID_DEFINITION');
  const folderId = tag.folderId == null ? null : boundedText(tag.folderId, 80), ordered: typeof folders = [];
  for (let id = folderId; id !== null;) {
    const f = folders.find(f => f.id === id);
    if (!f || ordered.some(p => p.id === id)) throw new HqTemplateError('INVALID_DEFINITION');
    ordered.unshift(f); id = f.parentId;
  }
  if (ordered.length !== folders.length) throw new HqTemplateError('INVALID_DEFINITION');
  return { schemaVersion: 1, tag: { name: boundedText(tag.name), color: color(tag.color) ?? '#3B82F6', description: tag.description == null || tag.description === '' ? null : boundedText(tag.description, 2000), folderId }, folders: ordered };
}
// This same projection is checked inside the write batch, closing the read/write race.
const SNAPSHOT_SQL = `SELECT json_object(
 'tags',json((SELECT json_group_array(json_object('id',id,'name',name,'normalized_name',normalized_name,'color',color,'description',description,'folder_id',folder_id,'updated_at',updated_at,'version',version,'status',status)) FROM (SELECT * FROM tags WHERE line_account_id=? ORDER BY id))),
 'folders',json((SELECT json_group_array(json_object('id',id,'name',name,'parent_id',parent_id,'color',color,'updated_at',updated_at)) FROM (SELECT * FROM folders WHERE kind='tag' AND account_id=? ORDER BY id)))
) AS snapshot`;
export async function tagSnapshot(db: D1Database, accountId: string): Promise<string> {
  const row = await db.prepare(SNAPSHOT_SQL).bind(accountId, accountId).first<{ snapshot: string }>();
  if (!row) throw new HqTemplateError('SNAPSHOT_UNAVAILABLE', 500);
  return row.snapshot;
}
export function inspectTags(def: TagDefinition, snapshot: string): PreflightItem[] {
  const target = JSON.parse(snapshot) as Snapshot, items: PreflightItem[] = [], matched = new Map<string, string | null>();
  for (const f of def.folders) {
    const parent = f.parentId === null ? null : matched.get(f.parentId);
    const found = f.parentId !== null && !parent ? [] : target.folders.filter(t => t.parent_id === parent && normalizeScopedTagName(t.name) === normalizeScopedTagName(f.name));
    if (found.length > 1) throw new HqTemplateError('AMBIGUOUS_FOLDER', 409);
    const t = found[0]; matched.set(f.id, t?.id ?? null);
    items.push({ sourceId: `folder:${f.id}`, itemKind: 'folder', name: f.name, targetId: t?.id ?? null, expectedRevision: t?.updated_at ?? null, duplicate: Boolean(t), allowedModes: t ? ['overwrite', 'alias'] : ['create'] });
  }
  const found = target.tags.filter(t => normalizeScopedTagName(t.name) === normalizeScopedTagName(def.tag.name));
  if (found.length > 1) throw new HqTemplateError('AMBIGUOUS_TAG', 409);
  const t = found[0];
  items.push({ sourceId: 'tag', itemKind: 'tag', name: def.tag.name, targetId: t?.id ?? null, expectedRevision: t ? `${t.updated_at ?? ''}:${t.version}` : null, duplicate: Boolean(t), allowedModes: t ? t.status === 'archived' ? ['alias'] : ['overwrite', 'alias'] : ['create'] });
  return items;
}
export function nextAlias(name: string, occupied: string[]): string {
  const names = new Set(occupied.map(normalizeScopedTagName));
  for (let i = 2; i < 10000; i++) if (!names.has(normalizeScopedTagName(`${name} (${i})`))) return `${name} (${i})`;
  throw new HqTemplateError('ALIAS_EXHAUSTED', 409);
}
export function planTags(input: { accountId: string; actorId: string; definition: TagDefinition; snapshot: string; resolutions: readonly HqTemplateResolution[] }) {
  const { accountId, definition: def, snapshot } = input, state = JSON.parse(snapshot) as Snapshot;
  const items = inspectTags(def, snapshot);
  if (input.resolutions.length !== items.length || new Set(input.resolutions.map(r => r.sourceId)).size !== items.length) throw new HqTemplateError('SELECTION_REQUIRED', 409);
  const statements: HqTemplateStatement[] = [{ sql: `SELECT json(CASE WHEN (${SNAPSHOT_SQL})=? THEN '{}' ELSE 'VERSION_CONFLICT' END)`, bindings: [accountId, accountId, snapshot] }];
  const now = new Date().toISOString(), ids = new Map<string, string>(), resolutions: HqTemplateResolution[] = [];
  const counts = { created: 0, overwritten: 0, aliased: 0 };
  for (const item of items) {
    const selection = input.resolutions.find(r => r.sourceId === item.sourceId);
    if (!selection || !item.allowedModes.includes(selection.mode)) throw new HqTemplateError('SELECTION_REQUIRED', 409);
    const id = selection.mode === 'overwrite' ? item.targetId! : crypto.randomUUID();
    const f = def.folders.find(f => `folder:${f.id}` === item.sourceId), parent = f?.parentId ? ids.get(`folder:${f.parentId}`)! : null;
    if (f && selection.mode === 'overwrite' && state.folders.find(f => f.id === id)?.parent_id !== parent) throw new HqTemplateError('FOLDER_SELECTION_CONFLICT', 409);
    const name = selection.mode === 'alias' ? nextAlias(item.name, item.itemKind === 'tag' ? state.tags.map(t => t.name) : state.folders.filter(f => f.parent_id === parent).map(f => f.name)) : item.name;
    ids.set(item.sourceId, id);
    resolutions.push({ sourceId: item.sourceId, itemKind: item.itemKind, mode: selection.mode, targetId: id, aliasName: selection.mode === 'alias' ? name : undefined, expectedRevision: item.expectedRevision ?? undefined });
    if (f) {
      if (selection.mode === 'overwrite') statements.push({ sql: `UPDATE folders SET name=?,color=?,updated_at=? WHERE id=? AND kind='tag' AND account_id=?`, bindings: [name, f.color, now, id, accountId] });
      else statements.push({ sql: `INSERT INTO folders(id,kind,name,parent_id,color,account_id,created_at,updated_at) VALUES (?,'tag',?,?,?,?,?,?)`, bindings: [id, name, parent, f.color, accountId, now, now] });
    } else {
      const folderId = def.tag.folderId ? ids.get(`folder:${def.tag.folderId}`)! : null;
      if (selection.mode === 'overwrite') statements.push({ sql: `UPDATE tags SET name=?,normalized_name=?,color=?,description=?,folder_id=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND line_account_id=?`, bindings: [name, normalizeScopedTagName(name), def.tag.color, def.tag.description, folderId, input.actorId, now, id, accountId] });
      else statements.push({ sql: `INSERT INTO tags(id,name,normalized_name,color,description,folder_id,line_account_id,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, bindings: [id, name, normalizeScopedTagName(name), def.tag.color, def.tag.description, folderId, accountId, input.actorId, input.actorId, now, now] });
    }
    if (selection.mode === 'create') counts.created++; else if (selection.mode === 'overwrite') counts.overwritten++; else counts.aliased++;
  }
  return { statements, resolutions, counts };
}
export const tagHqTemplateAdapter = unsupportedHqTemplateAdapter('tag');

/** A fresh adapter per store; no tenant, definition or snapshot is kept globally. */
export function createTagHqTemplateAdapter(db: D1Database, authority: HqTemplateAuthority): HqTemplateAdapter {
  let definition: TagDefinition | null = null, snapshot: string | null = null;
  let plan: ReturnType<typeof planTags> | null = null;
  let binding: string | null = null, versionId: string | null = null;
  const assertContext = (context: Parameters<HqTemplateAdapter['buildIdMap']>[0]) => {
    if (binding !== JSON.stringify(context)) throw new HqTemplateError('INVALID_PREFLIGHT', 409);
  };
  return {
    type: 'tag',
    async extractReferences(input) {
      snapshot = null; plan = null; binding = null; versionId = input.templateVersionId;
      definition = parseTagDefinition(JSON.parse(input.definitionJson));
      return { kind: 'OK', value: [...definition.folders.map(f => ({ kind: 'folder', sourceId: `folder:${f.id}` })), { kind: 'tag', sourceId: 'tag' }] };
    },
    async verifyReferences(context, references) {
      plan = null; binding = null;
      if (!definition || context.tenantId !== authority.tenantId) throw new HqTemplateError('FORBIDDEN', 403);
      const account = await db.prepare(`SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL`).bind(context.targetAccountId, authority.tenantId).first();
      if (!account) throw new HqTemplateError('FORBIDDEN', 403);
      snapshot = await tagSnapshot(db, context.targetAccountId);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))), b => b.toString(16).padStart(2, '0')).join('');
      if (context.snapshotToken !== `hqts1.${hash}`) throw new HqTemplateError('VERSION_CONFLICT', 409);
      const items = inspectTags(definition, snapshot);
      if (JSON.stringify(references) !== JSON.stringify(items.map(i => ({ kind: i.itemKind, sourceId: i.sourceId })))) throw new HqTemplateError('INVALID_DEFINITION');
      binding = JSON.stringify(context);
      return { kind: 'OK', value: items.map(i => ({ kind: i.itemKind, sourceId: i.sourceId, targetId: i.targetId ?? '' })) };
    },
    async detectDuplicates(context) {
      assertContext(context);
      return { kind: 'OK', value: inspectTags(definition!, snapshot!).filter(i => i.duplicate).map(i => ({ sourceId: i.sourceId, targetId: i.targetId!, reason: 'normalized_name' })) };
    },
    async buildIdMap(context) {
      assertContext(context);
      plan = planTags({ accountId: context.targetAccountId, actorId: authority.actorId, definition: definition!, snapshot: snapshot!, resolutions: context.resolutions });
      return { kind: 'OK', value: Object.fromEntries(plan.resolutions.map(r => [r.sourceId, r.targetId!])) };
    },
    async buildCommitPlan(context, input, idMap) {
      assertContext(context);
      if (!plan || versionId !== input.templateVersionId || JSON.stringify(parseTagDefinition(JSON.parse(input.definitionJson))) !== JSON.stringify(definition) || JSON.stringify(idMap) !== JSON.stringify(Object.fromEntries(plan.resolutions.map(r => [r.sourceId, r.targetId!])))) throw new HqTemplateError('INVALID_DEFINITION');
      return { kind: 'OK', value: { tenantId: context.tenantId, targetAccountId: context.targetAccountId, preflightId: context.preflightId, idempotencyFingerprint: context.idempotencyFingerprint, snapshotToken: context.snapshotToken, mode: context.mode, resolutions: plan.resolutions, stage: [], dbCommit: plan.statements, compensateOnDbFailure: [], reconcile: [] } };
    },
  };
}
