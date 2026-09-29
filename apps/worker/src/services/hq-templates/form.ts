import { normalizeScopedTagName } from '@line-crm/db';
import { layoutToFields, normalizeLayout, type FormLayout } from '@line-crm/shared';
import { unsupportedHqTemplateAdapter, requireHqTemplateAuthority, type HqTemplateAdapter, type HqTemplateAdapterContext, type HqTemplateAdapterInput, type HqTemplateAuthority, type HqTemplateReference, type HqTemplateStatement, type HqTemplateSnapshotToken, type HqTemplateStoreAtomicCommitPlan, } from './contract.js';
import { bindScenarioGraphRevision, loadScenarioReferenceGraph, scenarioGraphSnapshotToken, ScenarioGraphError } from './scenario-graph.js';
/** Unbound callers remain closed until the common executor provides dependencies. */
export const formHqTemplateAdapter = unsupportedHqTemplateAdapter('form');
export class FormTemplateError extends Error {
    constructor(public readonly code: 'INVALID_DEFINITION' | 'FORBIDDEN' | 'REFERENCE_UNAVAILABLE' | 'UNSUPPORTED_REFERENCE' | 'VERSION_CONFLICT' | 'SELECTION_REQUIRED' | 'SHARED_FORM' | 'INVALID_PHASE' | 'LIFF_UNAVAILABLE') { super(code); }
}
export type FormTemplateDefinition = {
    schemaVersion: 1;
    form: {
        name: string;
        description: string | null;
        fields: Record<string, unknown>[];
        layout: FormLayout | null;
        on_submit_tag_id: string | null;
        on_submit_scenario_id: string | null;
        save_to_metadata: boolean;
    };
};
export type FormReference = HqTemplateReference & {
    kind: 'tag' | 'scenario' | 'template';
};
export type FormReferenceResolution = {
    targetId: string;
    aliasName?: string;
    /** The target is created or updated by an earlier statement in this same atomic plan. */
    planned?: boolean;
    /** A trusted reference adapter's plan; it must not write before this batch. */
    dbCommit?: readonly HqTemplateStatement[];
};
export type FormTemplateDependencies = {
    db: D1Database;
    authority: HqTemplateAuthority;
    resolveReference: (reference: FormReference, context: HqTemplateAdapterContext) => Promise<FormReferenceResolution>;
};
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new FormTemplateError('INVALID_DEFINITION');
    return value as Record<string, unknown>;
}
function text(value: unknown, max = 200): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw new FormTemplateError('INVALID_DEFINITION');
    return value.trim();
}
function optionalText(value: unknown, max = 2000): string | null { return value == null || value === '' ? null : text(value, max); }
const referenceKey = (kind: string, id: string) => `${kind}:${id}`;
/** Match the form editor's absolute HTTP(S) contract; account links need an explicit resolver. */
function validatePortableUrl(value: unknown): void {
    if (value == null || value === '') return;
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value))
        throw new FormTemplateError('INVALID_DEFINITION');
    if (!value.trim()) return;
    let url: URL;
    const decode = (raw: string): string => {
        let current = raw;
        for (let i = 0; i < 3; i++) {
            if (!/%[0-9a-f]{2}/i.test(current)) return current;
            const next = decodeURIComponent(current);
            if (next === current) return current;
            current = next;
        }
        // Do not silently accept indefinitely encoded account references.
        if (/%[0-9a-f]{2}/i.test(current)) throw new FormTemplateError('UNSUPPORTED_REFERENCE');
        return current;
    };
    let path: string, query: string, hash: string, keys: string[];
    try {
        url = new URL(value.trim());
        path = decode(url.pathname); query = decode(url.search); hash = decode(url.hash);
        keys = [...url.searchParams.keys()].map(decode);
        if ([path, query, hash, ...keys].some(part => /[\u0000-\u001f\u007f\\]/.test(part)))
            throw new FormTemplateError('INVALID_DEFINITION');
    } catch (error) {
        if (error instanceof FormTemplateError) throw error;
        throw new FormTemplateError('INVALID_DEFINITION');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new FormTemplateError('INVALID_DEFINITION');
    const referenceParameter = /^(?:form|template|scenario|tag|(?:line)?account)(?:s|ids?)?$/;
    const referencePath = /(?:^|\/)(?:forms?|templates?|scenarios?|tags?|accounts?)\//i;
    const referenceFragment = /(?:^|[?&#/])(?:forms?|templates?|scenarios?|tags?|accounts?)(?:[_-]?ids?)?[=\/]/i;
    const liff = /(?:^|\/\/)(?:liff|miniapp)\.line\.me(?:[./:?#]|$)/i;
    if (['liff.line.me', 'miniapp.line.me'].includes(url.hostname.replace(/\.$/, ''))
        || keys.some(key => referenceParameter.test(key.replace(/[_-]/g, '').toLowerCase()) || key.toLowerCase() === 'liff.state')
        || [path, query, hash].some(part => referencePath.test(part) || referenceFragment.test(part) || liff.test(part)))
        throw new FormTemplateError('UNSUPPORTED_REFERENCE');
}
/** The visitor remaps supported references and rejects unknown cross-account dependencies. */
function visitLayout(value: unknown, resolve: (kind: 'tag' | 'scenario', id: string) => string): unknown {
    if (Array.isArray(value))
        return value.map(v => visitLayout(v, resolve));
    if (!value || typeof value !== 'object')
        return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (['url', 'linkUrl', 'thanksUrl'].includes(key)) validatePortableUrl(item);
        if (['friendFieldId', 'friendFieldIds', 'choiceFriendFieldId', 'fieldId', 'templateId', 'reminderId', 'mediaUrl', 'backgroundImageUrl'].includes(key) && item != null && item !== '' && !(Array.isArray(item) && !item.length))
            throw new FormTemplateError('UNSUPPORTED_REFERENCE');
        if ((key === 'tagId' || key === 'scenarioId') && item != null && item !== '')
            result[key] = resolve(key === 'tagId' ? 'tag' : 'scenario', text(item, 160));
        else if (key === 'tagIds') {
            if (!Array.isArray(item))
                throw new FormTemplateError('INVALID_DEFINITION');
            result[key] = item.map(id => resolve('tag', text(id, 160)));
        }
        else
            result[key] = visitLayout(item, resolve);
    }
    return result;
}
export function parseFormTemplateDefinition(input: HqTemplateAdapterInput): FormTemplateDefinition {
    if (input.definitionJson.length > 256000)
        throw new FormTemplateError('INVALID_DEFINITION');
    let root: Record<string, unknown>;
    try {
        root = object(JSON.parse(input.definitionJson));
    }
    catch {
        throw new FormTemplateError('INVALID_DEFINITION');
    }
    if (root.schemaVersion !== 1)
        throw new FormTemplateError('INVALID_DEFINITION');
    const form = object(root.form);
    // Webhook credentials, source URLs, publication flags and answer data are not portable configuration.
    const allowed = new Set(['name', 'description', 'fields', 'layout', 'on_submit_tag_id', 'on_submit_scenario_id', 'save_to_metadata']);
    if (Object.keys(form).some(k => !allowed.has(k)))
        throw new FormTemplateError('INVALID_DEFINITION');
    const layout = form.layout == null ? null : normalizeLayout(form.layout);
    if (form.layout != null && !layout)
        throw new FormTemplateError('INVALID_DEFINITION');
    if (layout)
        visitLayout(layout, (_kind, id) => id);
    let fields: Record<string, unknown>[];
    if (layout)
        fields = layoutToFields(layout) as unknown as Record<string, unknown>[];
    else {
        if (!Array.isArray(form.fields) || form.fields.length > 100)
            throw new FormTemplateError('INVALID_DEFINITION');
        fields = form.fields.map(value => {
            const field = object(value);
            if (Object.keys(field).some(k => !['name', 'label', 'type', 'required', 'options', 'placeholder', 'description'].includes(k)))
                throw new FormTemplateError('UNSUPPORTED_REFERENCE');
            if (!['text', 'textarea', 'radio', 'checkbox', 'select', 'file', 'date', 'prefecture'].includes(String(field.type)))
                throw new FormTemplateError('INVALID_DEFINITION');
            const result: Record<string, unknown> = { name: text(field.name), label: text(field.label), type: field.type };
            if (field.required !== undefined) {
                if (typeof field.required !== 'boolean')
                    throw new FormTemplateError('INVALID_DEFINITION');
                result.required = field.required;
            }
            if (field.options !== undefined) {
                if (!Array.isArray(field.options) || field.options.length > 100)
                    throw new FormTemplateError('INVALID_DEFINITION');
                result.options = field.options.map(v => text(v));
            }
            for (const key of ['placeholder', 'description'])
                if (field[key] !== undefined)
                    result[key] = optionalText(field[key]);
            return result;
        });
    }
    if (fields.length > 100 || new Set(fields.map(f => f.name)).size !== fields.length)
        throw new FormTemplateError('INVALID_DEFINITION');
    if (form.save_to_metadata !== undefined && typeof form.save_to_metadata !== 'boolean')
        throw new FormTemplateError('INVALID_DEFINITION');
    return { schemaVersion: 1, form: { name: text(form.name), description: optionalText(form.description), fields, layout, on_submit_tag_id: optionalText(form.on_submit_tag_id, 160), on_submit_scenario_id: optionalText(form.on_submit_scenario_id, 160), save_to_metadata: form.save_to_metadata !== false } };
}
function references(def: FormTemplateDefinition): FormReference[] {
    const refs = new Map<string, FormReference>();
    const add = (kind: 'tag' | 'scenario', id: string) => { refs.set(referenceKey(kind, id), { kind, sourceId: id }); return id; };
    if (def.form.on_submit_tag_id)
        add('tag', def.form.on_submit_tag_id);
    if (def.form.on_submit_scenario_id)
        add('scenario', def.form.on_submit_scenario_id);
    visitLayout(def.form.layout, add);
    return [...refs.values()].sort((a, b) => referenceKey(a.kind, a.sourceId).localeCompare(referenceKey(b.kind, b.sourceId)));
}
// Answer counts, submissions and deletion-impact revision intentionally do not enter
// content comparison: a new answer must not masquerade as an editor conflict.
const SNAPSHOT_SQL = `SELECT json_object(
 'account',json((SELECT json_object('id',id,'tenant',tenant_id,'active',is_active,'archived',archived_at,'liff',liff_id) FROM line_accounts WHERE id=?)),
 'forms',json((SELECT json_group_array(json_object('id',id,'name',name,'description',description,'fields',fields,'layout',layout,'tag',on_submit_tag_id,'scenario',on_submit_scenario_id,'active',is_active,'status',status,'content_revision',content_revision,'owners',json((SELECT json_group_array(line_account_id) FROM (SELECT line_account_id FROM form_accounts WHERE form_id=f.id ORDER BY line_account_id))))) FROM (SELECT f.* FROM forms f WHERE EXISTS(SELECT 1 FROM form_accounts WHERE form_id=f.id AND line_account_id=?) ORDER BY f.id) f)),
 'tags',json((SELECT json_group_array(json_object('id',id,'name',name,'version',version,'updated_at',updated_at,'status',status)) FROM (SELECT * FROM tags WHERE line_account_id=? ORDER BY id))),
 'scenarios',json((SELECT json_group_array(json_object('id',id,'name',name,'updated_at',updated_at,'active',is_active,'published',current_published_version_id)) FROM (SELECT * FROM scenarios WHERE line_account_id=? ORDER BY id))),
 'templates',json((SELECT json_group_array(json_object('id',id,'name',name,'updated_at',updated_at,'draft_revision',draft_revision,'published_version',published_version)) FROM (SELECT * FROM templates WHERE line_account_id=? ORDER BY id)))
) AS snapshot`;
type FormSnapshot = {
    account: {
        id: string;
        tenant: string | null;
        active: number;
        archived: string | null;
        liff: string | null;
    } | null;
    forms: {
        id: string;
        name: string;
        status: string;
        content_revision: number;
        owners: string[];
    }[];
    tags: {
        id: string;
        name: string;
        version: number;
        updated_at: string | null;
        status: string;
    }[];
    scenarios: {
        id: string;
        name: string;
        updated_at: string | null;
    }[];
    templates: {
        id: string;
        name: string;
        updated_at: string | null;
        draft_revision: number;
        published_version: number;
    }[];
};
export async function formTemplateSnapshot(db: D1Database, accountId: string): Promise<string> {
    const result = await db.prepare(SNAPSHOT_SQL).bind(accountId, accountId, accountId, accountId, accountId).first<{
        snapshot: string;
    }>();
    if (!result)
        throw new FormTemplateError('VERSION_CONFLICT');
    return result.snapshot;
}
export async function formTemplateSnapshotToken(snapshot: string): Promise<HqTemplateSnapshotToken> {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))), b => b.toString(16).padStart(2, '0')).join('');
    return `hqts1.${hash}` as HqTemplateSnapshotToken;
}
function target(state: FormSnapshot, name: string) {
    const matches = state.forms.filter(f => normalizeScopedTagName(f.name) === normalizeScopedTagName(name));
    if (matches.length > 1)
        throw new FormTemplateError('SELECTION_REQUIRED');
    return matches[0] ?? null;
}
function guard(sql: string, bindings: HqTemplateStatement['bindings']): HqTemplateStatement {
    return { sql: `SELECT json(CASE WHEN (${sql}) THEN '{}' ELSE 'FORM_VERSION_CONFLICT' END)`, bindings };
}
function authorize(authority: HqTemplateAuthority, context: Pick<HqTemplateAdapterContext, 'tenantId' | 'targetAccountId'>, state: FormSnapshot) {
    if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || authority.tenantId !== context.tenantId || state.account?.tenant !== authority.tenantId || state.account.active !== 1 || state.account.archived)
        throw new FormTemplateError('FORBIDDEN');
}
export async function inspectFormTemplate(db: D1Database, authority: HqTemplateAuthority, accountId: string, input: HqTemplateAdapterInput) {
    const def = parseFormTemplateDefinition(input), snapshot = await formTemplateSnapshot(db, accountId), state = JSON.parse(snapshot) as FormSnapshot;
    authorize(authority, { tenantId: authority.tenantId, targetAccountId: accountId }, state);
    const found = target(state, def.form.name);
    const allowedModes = !found ? ['create'] as const : found.status === 'archived' || found.owners.length !== 1 ? ['alias'] as const : ['overwrite', 'alias'] as const;
    return { snapshot, snapshotToken: await formTemplateSnapshotToken(snapshot), sourceId: 'form', itemKind: 'form', name: def.form.name, targetId: found?.id ?? null, expectedRevision: found ? String(found.content_revision) : null, duplicate: Boolean(found), allowedModes, references: references(def) };
}
/** Preflight rows make every form reference an explicit, immutable operator decision. */
export async function inspectFormTemplateReferences(db: D1Database, authority: HqTemplateAuthority, accountId: string, input: HqTemplateAdapterInput, inspectedSnapshot?: string) {
    const def = parseFormTemplateDefinition(input), snapshot = inspectedSnapshot ?? await formTemplateSnapshot(db, accountId), state = JSON.parse(snapshot) as FormSnapshot;
    authorize(authority, { tenantId: authority.tenantId, targetAccountId: accountId }, state);
    const directReferences = references(def);
    const expanded = new Map(directReferences.map(reference => [referenceKey(reference.kind, reference.sourceId), reference]));
    const scenarioIds = directReferences.filter(reference => reference.kind === 'scenario').map(reference => reference.sourceId);
    const scenarioGraphRevisions = new Map<string, string>();
    if (scenarioIds.length) {
        try {
            for (const scenarioId of scenarioIds) {
                const graph = await loadScenarioReferenceGraph(db, authority.tenantId, [scenarioId]);
                scenarioGraphRevisions.set(scenarioId, await scenarioGraphSnapshotToken(graph.snapshot));
                for (const reference of graph.references)
                    expanded.set(referenceKey(reference.kind, reference.sourceId), reference);
            }
        } catch (error) {
            if (error instanceof ScenarioGraphError)
                throw new FormTemplateError(error.code);
            throw error;
        }
    }
    const referenceItems = [];
    for (const reference of [...expanded.values()].sort((a, b) => referenceKey(a.kind, a.sourceId).localeCompare(referenceKey(b.kind, b.sourceId)))) {
        const source = reference.kind === 'tag'
            ? await db.prepare(`SELECT t.name FROM tags t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.status='active' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(reference.sourceId, authority.tenantId).first<{ name: string }>()
            : reference.kind === 'scenario'
                ? await db.prepare(`SELECT s.name FROM scenarios s JOIN line_accounts a ON a.id=s.line_account_id WHERE s.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(reference.sourceId, authority.tenantId).first<{ name: string }>()
                : await db.prepare(`SELECT t.name FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(reference.sourceId, authority.tenantId).first<{ name: string }>();
        if (!source)
            throw new FormTemplateError('REFERENCE_UNAVAILABLE');
        const matches = reference.kind === 'tag'
            ? state.tags.filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(source.name))
            : reference.kind === 'scenario'
                ? state.scenarios.filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(source.name))
                : state.templates.filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(source.name));
        if (matches.length > 1 || (reference.kind === 'tag' && state.tags.filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(source.name)).some(row => row.status !== 'active')))
            throw new FormTemplateError('SELECTION_REQUIRED');
        const match = matches[0] ?? null;
        const targetRevision = match
            ? reference.kind === 'tag'
                ? JSON.stringify([(match as FormSnapshot['tags'][number]).version, match.updated_at])
                : reference.kind === 'scenario'
                    ? JSON.stringify([match.updated_at])
                    : JSON.stringify([(match as FormSnapshot['templates'][number]).draft_revision, (match as FormSnapshot['templates'][number]).published_version, match.updated_at])
            : null;
        const expectedRevision = reference.kind === 'scenario' && scenarioGraphRevisions.has(reference.sourceId)
            ? bindScenarioGraphRevision(targetRevision, scenarioGraphRevisions.get(reference.sourceId)!)
            : targetRevision;
        referenceItems.push({
            sourceId: referenceKey(reference.kind, reference.sourceId),
            itemKind: reference.kind,
            name: source.name,
            targetId: match?.id ?? null,
            expectedRevision,
            duplicate: Boolean(match),
            allowedModes: match ? ['overwrite', 'alias'] as const : ['create'] as const,
        });
    }
    return referenceItems;
}
/** The URL is derived from the destination LIFF and stable form ID, never copied. */
export async function formTemplatePublicUrl(db: D1Database, authority: HqTemplateAuthority, accountId: string, formId: string): Promise<string | null> {
    if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED')
        throw new FormTemplateError('FORBIDDEN');
    const row = await db.prepare(`SELECT a.liff_id FROM line_accounts a JOIN form_accounts fa ON fa.line_account_id=a.id WHERE a.id=? AND fa.form_id=? AND a.tenant_id=?`).bind(accountId, formId, authority.tenantId).first<{
        liff_id: string | null;
    }>();
    return row?.liff_id ? `https://liff.line.me/${encodeURIComponent(row.liff_id)}/forms/${encodeURIComponent(formId)}` : null;
}
/** Produces an atomic plan only. The shared executor owns result claims and audits. */
export function createFormHqTemplateAdapter(deps: FormTemplateDependencies): HqTemplateAdapter {
    let def: FormTemplateDefinition | null = null, inputBinding: string | null = null, contextBinding: string | null = null, snapshot: string | null = null;
    let resolved = new Map<string, FormReferenceResolution>(), planned: HqTemplateStoreAtomicCommitPlan | null = null;
    const check = (context: HqTemplateAdapterContext) => { if (!def || !snapshot || contextBinding !== JSON.stringify(context))
        throw new FormTemplateError('INVALID_PHASE'); };
    return {
        type: 'form',
        async extractReferences(input) { def = parseFormTemplateDefinition(input); inputBinding = JSON.stringify(input); contextBinding = null; snapshot = null; resolved = new Map(); planned = null; return { kind: 'OK', value: references(def) }; },
        async verifyReferences(context, refs) {
            contextBinding = null;
            planned = null;
            resolved = new Map();
            if (!def || JSON.stringify(refs) !== JSON.stringify(references(def)))
                throw new FormTemplateError('INVALID_PHASE');
            snapshot = await formTemplateSnapshot(deps.db, context.targetAccountId);
            const state = JSON.parse(snapshot) as FormSnapshot;
            authorize(deps.authority, context, state);
            if (!state.account?.liff)
                throw new FormTemplateError('LIFF_UNAVAILABLE');
            if (await formTemplateSnapshotToken(snapshot) !== context.snapshotToken)
                throw new FormTemplateError('VERSION_CONFLICT');
            for (const ref of references(def)) {
                const mapped = await deps.resolveReference(ref, context);
                text(mapped?.targetId, 160);
                resolved.set(referenceKey(ref.kind, ref.sourceId), mapped);
                if (!mapped.dbCommit?.length && !mapped.planned) {
                    const table = ref.kind === 'tag' ? 'tags' : 'scenarios';
                    if (!await deps.db.prepare(`SELECT id FROM ${table} WHERE id=? AND line_account_id=?${ref.kind === 'tag' ? " AND status='active'" : ''}`).bind(mapped.targetId, context.targetAccountId).first())
                        throw new FormTemplateError('REFERENCE_UNAVAILABLE');
                }
            }
            contextBinding = JSON.stringify(context);
            return { kind: 'OK', value: references(def).map(r => ({ ...r, targetId: resolved.get(referenceKey(r.kind, r.sourceId))!.targetId })) };
        },
        async detectDuplicates(context) { check(context); const found = target(JSON.parse(snapshot!) as FormSnapshot, def!.form.name); return { kind: 'OK', value: found ? [{ sourceId: 'form', targetId: found.id, reason: 'normalized_name' }] : [] }; },
        async buildIdMap(context) {
            check(context);
            const state = JSON.parse(snapshot!) as FormSnapshot, found = target(state, def!.form.name);
            const selection = context.resolutions.find(r => r.sourceId === 'form' && r.itemKind === 'form');
            if (!selection || selection.mode !== context.mode || context.resolutions.filter(r => r.sourceId === 'form').length !== 1 || !['create', 'overwrite', 'alias'].includes(selection.mode) || (!found ? selection.mode !== 'create' : selection.mode === 'create'))
                throw new FormTemplateError('SELECTION_REQUIRED');
            if (selection.mode === 'overwrite' && (found!.status === 'archived' || found!.owners.length !== 1 || found!.owners[0] !== context.targetAccountId))
                throw new FormTemplateError('SHARED_FORM');
            if (found && (selection.targetId !== found.id || selection.expectedRevision !== String(found.content_revision)))
                throw new FormTemplateError('VERSION_CONFLICT');
            const id = selection.mode === 'overwrite' ? found!.id : crypto.randomUUID();
            let name = def!.form.name;
            if (selection.mode === 'alias') {
                const names = new Set(state.forms.map(f => normalizeScopedTagName(f.name)));
                let i = 2;
                while (names.has(normalizeScopedTagName(`${name} (${i})`)) && i < 10000)
                    i++;
                if (i === 10000)
                    throw new FormTemplateError('SELECTION_REQUIRED');
                name = `${name} (${i})`;
            }
            const ids: Record<string, string> = { form: id };
            for (const [key, value] of resolved)
                ids[key] = value.targetId;
            const map = (kind: 'tag' | 'scenario', source: string) => { const value = ids[referenceKey(kind, source)]; if (!value)
                throw new FormTemplateError('REFERENCE_UNAVAILABLE'); return value; };
            const layout = def!.form.layout ? visitLayout(def!.form.layout, map) as FormLayout : null;
            const fields = layout ? layoutToFields(layout) : def!.form.fields;
            const tagId = def!.form.on_submit_tag_id ? map('tag', def!.form.on_submit_tag_id) : null;
            const scenarioId = def!.form.on_submit_scenario_id ? map('scenario', def!.form.on_submit_scenario_id) : null;
            const statements: HqTemplateStatement[] = [guard(`(${SNAPSHOT_SQL})=?`, [context.targetAccountId, context.targetAccountId, context.targetAccountId, context.targetAccountId, context.targetAccountId, snapshot!])];
            statements.push(guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [context.targetAccountId, deps.authority.tenantId]));
            for (const value of resolved.values())
                statements.push(...value.dbCommit ?? []);
            for (const ref of references(def!)) {
                const table = ref.kind === 'tag' ? 'tags' : 'scenarios';
                statements.push(guard(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND line_account_id=?${ref.kind === 'tag' ? " AND status='active'" : ''})`, [ids[referenceKey(ref.kind, ref.sourceId)], context.targetAccountId]));
            }
            const values = [name, def!.form.description, JSON.stringify(fields), layout ? JSON.stringify(layout) : null, tagId, scenarioId, def!.form.save_to_metadata ? 1 : 0];
            if (selection.mode === 'overwrite')
                statements.push({ sql: `UPDATE forms SET name=?,description=?,fields=?,layout=?,on_submit_tag_id=?,on_submit_scenario_id=?,save_to_metadata=?,is_active=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,content_revision=content_revision+1 WHERE id=? AND content_revision=?`, bindings: [...values, id, found!.content_revision] });
            else
                statements.push({ sql: `INSERT INTO forms(id,name,description,fields,layout,on_submit_tag_id,on_submit_scenario_id,save_to_metadata,is_active) VALUES (?,?,?,?,?,?,?,?,0)`, bindings: [id, ...values] }, { sql: `INSERT INTO form_accounts(form_id,line_account_id) VALUES (?,?)`, bindings: [id, context.targetAccountId] });
            planned = { tenantId: context.tenantId, targetAccountId: context.targetAccountId, preflightId: context.preflightId, idempotencyFingerprint: context.idempotencyFingerprint, snapshotToken: context.snapshotToken, mode: context.mode, resolutions: context.resolutions.map(r => {
                if (r === selection)
                    return { ...r, targetId: id, aliasName: selection.mode === 'alias' ? name : undefined };
                const mapped = resolved.get(r.sourceId);
                return mapped ? { ...r, targetId: mapped.targetId, aliasName: mapped.aliasName } : r;
            }), stage: [], dbCommit: statements, compensateOnDbFailure: [], reconcile: [] };
            return { kind: 'OK', value: ids };
        },
        async buildCommitPlan(context, input, idMap) {
            check(context);
            if (!planned || inputBinding !== JSON.stringify(input) || JSON.stringify(idMap) !== JSON.stringify({ form: planned.resolutions.find(r => r.sourceId === 'form')!.targetId, ...Object.fromEntries([...resolved].map(([key, value]) => [key, value.targetId])) }))
                throw new FormTemplateError('INVALID_PHASE');
            return { kind: 'OK', value: planned };
        },
    };
}
