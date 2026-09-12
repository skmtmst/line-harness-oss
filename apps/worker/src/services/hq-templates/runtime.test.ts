import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { inspectFormTemplate } from './form.js';
import { buildFormRuntimePlan, executeFormStore, executeHqAtomicStore } from './runtime.js';
import type { HqTemplateAdapterContext, HqTemplateAuthority } from './contract.js';
let fixture: SqliteD1;
const authority: HqTemplateAuthority = { tenantId: 'tenant', actorId: 'owner', role: 'owner', readOnly: false, accountScoped: false };
const definition = { schemaVersion: 1, form: { name: 'Survey', description: null, fields: [{ name: 'answer', label: 'Answer', type: 'text' }], on_submit_tag_id: 'source-tag', on_submit_scenario_id: null } };
const input = { templateVersionId: 'version', definitionJson: JSON.stringify(definition) };
const options = (context: HqTemplateAdapterContext, db = fixture.db) => ({ db, authority, templateId: 'template', runId: 'run', context });
const count = (table: string) => (fixture.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
async function preflight(account: string): Promise<HqTemplateAdapterContext> {
  const info = await inspectFormTemplate(fixture.db, authority, account, input), id = `preflight-${account}`;
  fixture.raw.prepare(`INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,created_by,expires_at) VALUES (?,'tenant','template','version',?,'create','run',?,'ready','owner','2099-01-01T00:00:00.000Z')`).run(id,account,info.snapshotToken);
  fixture.raw.prepare(`INSERT INTO hq_template_preflight_resolutions(preflight_id,tenant_id,template_id,template_version_id,target_account_id,idempotency_fingerprint,snapshot_token,source_id,item_kind,resolution_mode,target_id,expected_revision) VALUES (?,'tenant','template','version',?,'run',?,'form','form','create',?,?)`).run(id,account,info.snapshotToken,info.targetId,info.expectedRevision);
  return { tenantId:'tenant',targetAccountId:account,preflightId:id,idempotencyFingerprint:'run',snapshotToken:info.snapshotToken,mode:'create',resolutions:[{sourceId:'form',itemKind:'form',mode:'create'}] };
}
beforeEach(() => {
  fixture = createTestD1({foreignKeys:true});
  fixture.raw.exec("INSERT INTO tenants(id,name) VALUES ('tenant','Tenant'),('other','Other')");
  for (const id of ['source','a','b','c','foreign']) fixture.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id) VALUES (?,?,?,'fixture','fixture',?,?)").run(id,id,id,id==='foreign'?'other':'tenant',`liff-${id}`);
  fixture.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES ('source-tag','ＶＩＰ','source'); INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('template','tenant','form','Survey')");
  fixture.raw.prepare("INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('version','tenant','template',1,?,'fixture')").run(input.definitionJson);
  fixture.raw.exec("UPDATE hq_templates SET current_version_id='version' WHERE id='template'");
});
afterEach(() => fixture.raw.close());
describe('form runtime and atomic store execution', () => {
  test('three stores receive private forms and local tags with one audit per store', async () => {
    for(const a of ['a','b','c']) expect(await executeFormStore(options(await preflight(a)))).toEqual({status:'succeeded',reused:false});
    expect(count('forms')).toBe(3); expect(count('tags')).toBe(4);
    const rows=fixture.raw.prepare('SELECT f.is_active,t.line_account_id,fa.line_account_id target FROM forms f JOIN tags t ON t.id=f.on_submit_tag_id JOIN form_accounts fa ON fa.form_id=f.id').all() as Array<{is_active:number;line_account_id:string;target:string}>;
    expect(rows.every(r=>r.is_active===0&&r.line_account_id===r.target)).toBe(true);
    expect(fixture.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='hq_template.distributed'").get()).toEqual({n:3}); expect(fixture.raw.pragma('foreign_key_check')).toEqual([]);
  });
  test('same-name active legacy tag reused in exact account without editing its metadata',async()=>{
    fixture.raw.exec("INSERT INTO tags(id,name,line_account_id,description) VALUES ('existing','vip','a','keep'),('foreign-tag','vip','foreign','other')");
    await executeFormStore(options(await preflight('a')));
    expect(fixture.raw.prepare('SELECT on_submit_tag_id FROM forms').get()).toEqual({on_submit_tag_id:'existing'});
    expect(fixture.raw.prepare("SELECT description FROM tags WHERE id='existing'").get()).toEqual({description:'keep'}); expect(count('tags')).toBe(3);
  });
  test.each(['foreign','missing','archived'])('%s source tag is rejected without destination writes',async kind=>{
    const c=await preflight('a');
    if(kind==='foreign')fixture.raw.exec("UPDATE tags SET line_account_id='foreign' WHERE id='source-tag'");
    if(kind==='missing')fixture.raw.exec("DELETE FROM tags WHERE id='source-tag'");
    if(kind==='archived')fixture.raw.exec("UPDATE tags SET status='archived' WHERE id='source-tag'");
    expect((await executeFormStore(options(c))).status).toBe('failed');expect(count('forms')).toBe(0);
    expect(fixture.raw.prepare("SELECT id FROM tags WHERE line_account_id='a'").all()).toEqual([]);
  });
  test('unsupported scenario never becomes an empty scenario or partially created tag',async()=>{
    fixture.raw.prepare("UPDATE hq_template_versions SET definition_json=? WHERE id='version'").run(JSON.stringify({...definition,form:{...definition.form,on_submit_scenario_id:'scenario'}}));
    expect((await executeFormStore(options(await preflight('a')))).status).toBe('unsupported');expect(count('forms')).toBe(0);expect(count('scenarios')).toBe(0);expect(count('tags')).toBe(1);
  });
  test('concurrent replay observes staged and never starts another business plan',async()=>{
    const c=await preflight('a');let release!:()=>void,entered!:()=>void,builds=0;
    const gate=new Promise<void>(r=>{release=r}),ready=new Promise<void>(r=>{entered=r});
    const first=executeHqAtomicStore({...options(c),buildPlan:async(context,input)=>{builds++;entered();await gate;return buildFormRuntimePlan({db:fixture.db,authority,context,input})}});
    await ready;expect(await executeFormStore(options(c))).toEqual({status:'staged',reused:true});release();expect((await first).status).toBe('succeeded');expect(builds).toBe(1);
    expect(await executeFormStore(options(c))).toEqual({status:'succeeded',reused:true});expect(count('forms')).toBe(1);expect(fixture.raw.prepare('SELECT attempt_count FROM hq_template_distribution_results').get()).toEqual({attempt_count:2});
  });
  test('lost successful batch response recovers success, not another creation',async()=>{
    const c=await preflight('a');const db={prepare:fixture.db.prepare.bind(fixture.db),batch:async(s:D1PreparedStatement[])=>{await fixture.db.batch(s);throw new Error('response lost')}}as unknown as D1Database;
    expect((await executeFormStore(options(c,db))).status).toBe('succeeded');await executeFormStore(options(c));expect(count('forms')).toBe(1);
    expect(fixture.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='hq_template.distributed'").get()).toEqual({n:1});
  });
  test('business failure rolls back tag, form, resolutions and success audit; unknown remains staged',async()=>{
    const c=await preflight('a');fixture.raw.exec("CREATE TRIGGER fail_form BEFORE INSERT ON forms BEGIN SELECT RAISE(ABORT,'fixture'); END");
    expect((await executeFormStore(options(c))).status).toBe('staged');expect(count('forms')).toBe(0);expect(count('tags')).toBe(1);
    expect(fixture.raw.prepare('SELECT target_id FROM hq_template_preflight_resolutions').get()).toEqual({target_id:null});expect(fixture.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='hq_template.distributed'").get()).toEqual({n:0});
    fixture.raw.exec('DROP TRIGGER fail_form');expect(await executeFormStore(options(c))).toEqual({status:'staged',reused:true});expect(count('forms')).toBe(0);
  });
  test('one destination edit conflicts without blocking another store',async()=>{
    const a=await preflight('a'),b=await preflight('b');fixture.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES ('changed','edited','a')");
    expect((await executeFormStore(options(a))).status).toBe('version_conflict');expect((await executeFormStore(options(b))).status).toBe('succeeded');expect(count('forms')).toBe(1);
  });
  test('source edit between plan and batch rolls back all destination writes',async()=>{
    const c=await preflight('a');expect((await executeHqAtomicStore({...options(c),buildPlan:async(context,input)=>{const p=await buildFormRuntimePlan({db:fixture.db,authority,context,input});fixture.raw.exec("UPDATE tags SET name='changed' WHERE id='source-tag'");return p}})).status).toBe('staged');expect(count('forms')).toBe(0);expect(count('tags')).toBe(1);
  });
  test('changed replay choices and foreign authority cannot reuse the result',async()=>{
    const c=await preflight('a');await executeFormStore(options(c));
    await expect(executeFormStore(options({...c,mode:'alias',resolutions:[{sourceId:'form',itemKind:'form',mode:'alias'}]}))).rejects.toMatchObject({code:'SELECTION_CHANGED'});
    await expect(executeFormStore({...options(c),authority:{...authority,tenantId:'other'}})).rejects.toMatchObject({code:'FORBIDDEN'});expect(count('forms')).toBe(1);
  });
  test('simultaneous first submissions execute the plan once',async()=>{
    const c=await preflight('a');let builds=0;
    const run=()=>executeHqAtomicStore({...options(c),buildPlan:async(context,input)=>{builds++;return buildFormRuntimePlan({db:fixture.db,authority,context,input})}});
    const results=await Promise.all([run(),run()]);expect(builds).toBe(1);expect(results.some(r=>r.status==='succeeded')).toBe(true);expect(count('forms')).toBe(1);
  });
  test('pending claim interruption can resume without changing the immutable decision',async()=>{
    const c=await preflight('a');let blocked=true;
    const db={prepare:(sql:string)=>{if(blocked&&sql.startsWith("UPDATE hq_template_distribution_results SET status='staged'")){blocked=false;throw new Error('interrupted before claim')}return fixture.db.prepare(sql)},batch:fixture.db.batch.bind(fixture.db)}as unknown as D1Database;
    await expect(executeFormStore(options(c,db))).rejects.toThrow('interrupted');
    expect(fixture.raw.prepare('SELECT status FROM hq_template_distribution_results').get()).toEqual({status:'pending'});
    expect((await executeFormStore(options(c))).status).toBe('succeeded');expect(count('forms')).toBe(1);
  });
  test('ambiguous or archived destination name fails without creating another tag',async()=>{
    fixture.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES ('duplicate1','vip','a'),('duplicate2','ＶＩＰ','a')");
    expect((await executeFormStore(options(await preflight('a')))).status).toBe('failed');expect(count('forms')).toBe(0);
  });
  test('expired preflight cannot be claimed',async()=>{
    const c=await preflight('a');fixture.raw.exec("UPDATE hq_template_preflights SET expires_at='2000-01-01T00:00:00Z'");
    await expect(executeFormStore(options(c))).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(count('hq_template_distribution_results')).toBe(0);
  });
  test('R2 plan is rejected before business writes',async()=>{
    const c=await preflight('a');const r=await executeHqAtomicStore({...options(c),buildPlan:async(context,input)=>({...await buildFormRuntimePlan({db:fixture.db,authority,context,input}),stage:[{key:'fixture',ownerToken:'fixture',bytes:new Uint8Array()}]})});expect(r.status).toBe('unsupported');expect(count('forms')).toBe(0);expect(count('tags')).toBe(1);
  });
});
