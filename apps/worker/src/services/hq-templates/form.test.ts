import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { updateForm } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { createFormHqTemplateAdapter, inspectFormTemplate, formTemplatePublicUrl, formTemplateSnapshot, formTemplateSnapshotToken, parseFormTemplateDefinition, type FormTemplateDependencies } from './form.js';
import type { HqTemplateAdapterInput, HqTemplateAdapterContext, HqTemplateAdapterResult, HqTemplateAuthority, HqTemplateStoreAtomicCommitPlan } from './contract.js';
let fixture: SqliteD1;
const authority: HqTemplateAuthority = { tenantId: 'tenant-a', actorId: 'owner', role: 'owner', readOnly: false, accountScoped: false };
const definition = { schemaVersion: 1, form: { name: 'アンケート', description: 'ご意見', fields: [{ name: 'answer', label: 'ご感想', type: 'text', required: true }], on_submit_tag_id: 'hq-tag', on_submit_scenario_id: 'hq-scenario' } };
const input: HqTemplateAdapterInput = { templateVersionId: 'version-1', definitionJson: JSON.stringify(definition) };
const ok = <T>(result: HqTemplateAdapterResult<T>): T => { expect(result.kind).toBe('OK'); if (result.kind !== 'OK')
    throw new Error('Unsupported'); return result.value; };
function resolver(): FormTemplateDependencies['resolveReference'] {
    return async (ref, context) => ({ targetId: `${context.targetAccountId}-${ref.kind}` });
}
async function preflight(accountId: string, mode: 'create' | 'overwrite' | 'alias' = 'create', source = input) {
    const info = await inspectFormTemplate(fixture.db, authority, accountId, source);
    const context: HqTemplateAdapterContext = { tenantId: authority.tenantId, targetAccountId: accountId, preflightId: `preflight-${accountId}`, idempotencyFingerprint: 'run', mode, snapshotToken: info.snapshotToken, resolutions: [{ sourceId: 'form', itemKind: 'form', mode, targetId: info.targetId ?? undefined, expectedRevision: info.expectedRevision ?? undefined }] };
    return { context, info };
}
async function plan(context: HqTemplateAdapterContext, source = input, resolveReference = resolver()) {
    const adapter = createFormHqTemplateAdapter({ db: fixture.db, authority, resolveReference });
    const refs = ok(await adapter.extractReferences(source)), verified = ok(await adapter.verifyReferences(context, refs));
    const duplicates = ok(await adapter.detectDuplicates(context, verified)), ids = ok(await adapter.buildIdMap(context, verified, duplicates));
    return ok(await adapter.buildCommitPlan(context, source, ids));
}
async function commit(p: HqTemplateStoreAtomicCommitPlan) { await fixture.db.batch(p.dbCommit.map(s => fixture.db.prepare(s.sql).bind(...s.bindings))); return p.resolutions.find(r => r.sourceId === 'form')!.targetId!; }
function rows() { return fixture.raw.prepare('SELECT * FROM forms ORDER BY id').all() as Array<Record<string, unknown>>; }
beforeEach(() => {
    fixture = createTestD1({ foreignKeys: true });
    fixture.raw.exec("INSERT INTO tenants(id,name) VALUES ('tenant-a','統括A'),('tenant-b','統括B')");
    for (const id of ['a1', 'a2', 'a3', 'b1']) {
        fixture.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id) VALUES (?,?,?,'fixture','fixture',?,?)").run(id, id, `fixture-${id}`, id === 'b1' ? 'tenant-b' : 'tenant-a', `liff-${id}`);
        fixture.raw.prepare('INSERT INTO tags(id,name,line_account_id) VALUES (?,?,?)').run(`${id}-tag`, `配布先${id}`, id);
        fixture.raw.prepare("INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES (?,?,'manual',?)").run(`${id}-scenario`, `配布先${id}`, id);
    }
});
afterEach(() => fixture.raw.close());
describe('HQ form atomic plans', () => {
    test('three destination drafts have new stable URLs and local tag/scenario references', async () => {
        const urls = [];
        for (const account of ['a1', 'a2', 'a3']) {
            const { context } = await preflight(account), p = await plan(context), id = await commit(p);
            urls.push(await formTemplatePublicUrl(fixture.db, authority, account, id));
            expect(fixture.raw.prepare('SELECT is_active,on_submit_tag_id,on_submit_scenario_id,content_revision FROM forms WHERE id=?').get(id)).toEqual({ is_active: 0, on_submit_tag_id: `${account}-tag`, on_submit_scenario_id: `${account}-scenario`, content_revision: 1 });
            expect(await formTemplatePublicUrl(fixture.db, authority, 'b1', id)).toBeNull();
        }
        expect(rows()).toHaveLength(3);
        expect(new Set(urls).size).toBe(3);
        expect(urls.every(url => url?.startsWith('https://liff.line.me/liff-a'))).toBe(true);
        expect(fixture.raw.pragma('foreign_key_check')).toEqual([]);
    });
    test('overwrite preserves form ID, answers, URL and old editor conflict semantics', async () => {
        const id = await commit(await plan((await preflight('a1')).context));
        fixture.raw.prepare("INSERT INTO form_submissions(id,form_id,data) VALUES ('answer',?,'{\"answer\":\"synthetic\"}')").run(id);
        fixture.raw.prepare('UPDATE forms SET is_active=1,submit_count=7 WHERE id=?').run(id);
        const answer = fixture.raw.prepare('SELECT * FROM form_submissions').get(), url = await formTemplatePublicUrl(fixture.db, authority, 'a1', id);
        const { context } = await preflight('a1', 'overwrite');
        await commit(await plan(context));
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ id, content_revision: 2, is_active: 0, submit_count: 7 });
        expect(fixture.raw.prepare('SELECT * FROM form_submissions').get()).toEqual(answer);
        expect(await formTemplatePublicUrl(fixture.db, authority, 'a1', id)).toBe(url);
        expect((await updateForm(fixture.db, id, { description: '古い編集' }, 1)).kind).toBe('conflict');
        expect((await updateForm(fixture.db, id, { description: '新しい編集' }, 2)).kind).toBe('updated');
    });
    test('new answers after preflight are retained and do not cause content conflicts', async () => {
        const id = await commit(await plan((await preflight('a1')).context)), { context } = await preflight('a1', 'overwrite');
        fixture.raw.prepare("INSERT INTO form_submissions(id,form_id,data) VALUES ('new-answer',?,'{}')").run(id);
        fixture.raw.prepare("INSERT INTO form_opens(id,form_id) VALUES ('opened',?)").run(id);
        await commit(await plan(context));
        expect(rows()[0].content_revision).toBe(2);
        expect(fixture.raw.prepare('SELECT count(*) n FROM form_submissions').get()).toEqual({ n: 1 });
    });
    test('one edited store fails version check, other store plans commit', async () => {
        for (const account of ['a1', 'a2', 'a3'])
            await commit(await plan((await preflight(account)).context));
        const checks = await Promise.all(['a1', 'a2', 'a3'].map(account => preflight(account, 'overwrite')));
        const id = (await inspectFormTemplate(fixture.db, authority, 'a2', input)).targetId!;
        await updateForm(fixture.db, id, { description: '店舗の編集' }, 1);
        const statuses = [];
        for (const check of checks) {
            try {
                await commit(await plan(check.context));
                statuses.push('succeeded');
            }
            catch (error) {
                statuses.push((error as {
                    code: string;
                }).code);
            }
        }
        expect(statuses).toEqual(['succeeded', 'VERSION_CONFLICT', 'succeeded']);
        expect(fixture.raw.prepare('SELECT description FROM forms WHERE id=?').get(id)).toEqual({ description: '店舗の編集' });
    });
    test('edit between plan and batch is rejected atomically', async () => {
        const id = await commit(await plan((await preflight('a1')).context)), p = await plan((await preflight('a1', 'overwrite')).context);
        await updateForm(fixture.db, id, { description: '直前の編集' }, 1);
        await expect(commit(p)).rejects.toThrow();
        expect(rows()[0]).toMatchObject({ description: '直前の編集', content_revision: 2 });
    });
    test('same-name aliases are (2), (3); duplicates require explicit choices', async () => {
        await commit(await plan((await preflight('a1')).context));
        await expect(plan((await preflight('a1')).context)).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
        await commit(await plan((await preflight('a1', 'alias')).context));
        await commit(await plan((await preflight('a1', 'alias')).context));
        expect(rows().map(r => r.name).sort()).toEqual(['アンケート', 'アンケート (2)', 'アンケート (3)']);
    });
    test('reference plans create before form inside one batch; any failure rolls everything back', async () => {
        const staged: FormTemplateDependencies['resolveReference'] = async (ref, c) => ({ targetId: `new-${c.targetAccountId}-${ref.kind}`, dbCommit: [ref.kind === 'tag' ? { sql: 'INSERT INTO tags(id,name,line_account_id) VALUES (?,?,?)', bindings: [`new-${c.targetAccountId}-tag`, `新タグ${c.targetAccountId}`, c.targetAccountId] } : { sql: "INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES (?,?,'manual',?)", bindings: [`new-${c.targetAccountId}-scenario`, '新シナリオ', c.targetAccountId] }] });
        fixture.raw.exec("CREATE TRIGGER reject_form BEFORE INSERT ON forms BEGIN SELECT RAISE(ABORT,'synthetic'); END");
        const p = await plan((await preflight('a1')).context, input, staged);
        await expect(commit(p)).rejects.toThrow();
        expect(rows()).toHaveLength(0);
        expect(fixture.raw.prepare("SELECT id FROM tags WHERE id LIKE 'new-%'").all()).toEqual([]);
        fixture.raw.exec('DROP TRIGGER reject_form');
        await commit(p);
        expect(rows()[0]).toMatchObject({ on_submit_tag_id: 'new-a1-tag', on_submit_scenario_id: 'new-a1-scenario' });
    });
    test('foreign tenant, wrong-store resolver and missing references fail closed', async () => {
        await expect(preflight('b1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const { context } = await preflight('a1');
        await expect(plan(context, input, async (ref) => ({ targetId: `b1-${ref.kind}` }))).rejects.toMatchObject({ code: 'REFERENCE_UNAVAILABLE' });
        await expect(plan(context, input, async () => ({ targetId: 'missing' }))).rejects.toMatchObject({ code: 'REFERENCE_UNAVAILABLE' });
        expect(rows()).toHaveLength(0);
    });
    test('a staged resolver cannot smuggle foreign ownership into the atomic commit', async () => {
        const p = await plan((await preflight('a1')).context, input, async (ref) => ({ targetId: `b1-${ref.kind}`, dbCommit: [{ sql: 'SELECT 1', bindings: [] }] }));
        await expect(commit(p)).rejects.toThrow();
        expect(rows()).toHaveLength(0);
    });
    test('forms shared by multiple stores cannot be overwritten indirectly', async () => {
        const id = await commit(await plan((await preflight('a1')).context));
        fixture.raw.prepare('INSERT INTO form_accounts(form_id,line_account_id) VALUES (?,?)').run(id, 'a2');
        const p = await preflight('a1', 'overwrite');
        expect(p.info.allowedModes).toEqual(['alias']);
        await expect(plan(p.context)).rejects.toMatchObject({ code: 'SHARED_FORM' });
        const alias = await plan((await preflight('a1', 'alias')).context);
        await commit(alias);
        expect(rows()).toHaveLength(2);
    });
    test('unsupported secrets and nested references are never copied silently', () => {
        for (const addition of [{ on_submit_webhook_headers: 'not-portable' }, { is_active: 1 }, { submit_count: 10 }])
            expect(() => parseFormTemplateDefinition({ ...input, definitionJson: JSON.stringify({ ...definition, form: { ...definition.form, ...addition } }) })).toThrow();
        expect(() => parseFormTemplateDefinition({ ...input, definitionJson: JSON.stringify({ ...definition, form: { ...definition.form, fields: [{ name: 'x', label: 'x', type: 'text', friendFieldId: 'source-field' }] } }) })).toThrow();
    });
    test('LIFF missing is explicit; default adapter remains unbound', async () => {
        fixture.raw.exec("UPDATE line_accounts SET liff_id=NULL WHERE id='a1'");
        await expect(plan((await preflight('a1')).context)).rejects.toMatchObject({ code: 'LIFF_UNAVAILABLE' });
        expect(rows()).toHaveLength(0);
    });
    test('nested tag/scenario layout references are remapped without changing answer names', async () => {
        const layout = { version: 2, header: [], sections: [{ id: 'page', name: '質問', blocks: [{ id: 'field', kind: 'input', name: 'answer', label: '質問', type: 'radio', choiceMode: 'tag', choices: [{ id: 'option', label: '選択', tagId: 'hq-tag' }] }] }], options: { afterActions: [{ kind: 'scenario', op: 'start', scenarioId: 'hq-scenario' }] } };
        const source = { ...input, definitionJson: JSON.stringify({ ...definition, form: { ...definition.form, layout } }) };
        await commit(await plan((await preflight('a1', 'create', source)).context, source));
        const stored = JSON.parse(rows()[0].layout as string);
        expect(stored.sections[0].blocks[0].choices[0].tagId).toBe('a1-tag');
        expect(stored.options.afterActions[0].scenarioId).toBe('a1-scenario');
        expect(JSON.parse(rows()[0].fields as string)[0].name).toBe('answer');
    });
    test('snapshot token changes for content edits but not answer accounting', async () => {
        const id = await commit(await plan((await preflight('a1')).context)), before = await formTemplateSnapshotToken(await formTemplateSnapshot(fixture.db, 'a1'));
        fixture.raw.prepare('UPDATE forms SET revision=revision+1,submit_count=submit_count+1 WHERE id=?').run(id);
        expect(await formTemplateSnapshotToken(await formTemplateSnapshot(fixture.db, 'a1'))).toBe(before);
        await updateForm(fixture.db, id, { name: '変更' }, 1);
        expect(await formTemplateSnapshotToken(await formTemplateSnapshot(fixture.db, 'a1'))).not.toBe(before);
    });
});
