import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHqTemplate, listHqTemplates } from '../src/hq-templates.js';
import { asD1 } from './d1-test-helper.js';
let sql:Database.Database;
beforeEach(()=>{sql=new Database(':memory:');sql.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));sql.pragma('foreign_keys=ON');});
afterEach(()=>sql.close());
test('配り方の3種類を読み分け、旧種類と版・外部キー・配布台帳を保つ',async()=>{
 for(const type of ['auto_reply','friend_add_rule','reminder','tag','template','rich_menu','form','scenario','friend_field','mark'] as const){
  const row=await createHqTemplate(asD1(sql),{id:type,tenantId:'t1',type,name:type});expect(row.template_type).toBe(type);
  expect((await listHqTemplates(asD1(sql),'t1',type)).map(r=>r.id)).toEqual([type]);
  sql.prepare(`INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES (?,'t1',?,1,'{}','h')`).run(`v-${type}`,type);
 }
 expect(sql.pragma('foreign_key_check')).toEqual([]);
});
test('不正な種類・矛盾した種類・あとから種類を変える更新を拒む',async()=>{
 const insert=sql.prepare(`INSERT INTO hq_templates(id,tenant_id,template_type,delivery_type,extended_type,friend_attribute_type,name) VALUES (?,'t1',?,?,?,?, '試験')`);
 expect(()=>insert.run('bad','template','other',null,null)).toThrow();
 expect(()=>insert.run('bad','tag','reminder',null,null)).toThrow('HQ_TYPE_INVALID');
 expect(()=>insert.run('bad','template','reminder','scenario',null)).toThrow('HQ_TYPE_INVALID');
 await createHqTemplate(asD1(sql),{id:'auto',tenantId:'t1',type:'auto_reply',name:'自動応答'});
 expect(()=>sql.exec("UPDATE hq_templates SET delivery_type=NULL WHERE id='auto'")).toThrow('HQ_TYPE_IMMUTABLE');
 expect(()=>sql.exec("UPDATE hq_templates SET extended_type='scenario' WHERE id='auto'")).toThrow('HQ_TYPE_IMMUTABLE');
});

test('622の適用前にあるひな形・版・配布の記録を変更せず3種類を追加する',async()=>{
 const previous=new Database(':memory:');
 try {
  previous.pragma('foreign_keys=ON');
  for(const name of ['381_hq_templates.sql','571_hq_scenario_templates.sql','612_hq_friend_attribute_templates.sql']) {
   previous.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  }
  previous.exec(`INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('old','t1','tag','既存のタグ');
   INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('old-v1','t1','old',1,'{"tag":{"name":"既存のタグ"}}','old-hash');
   UPDATE hq_templates SET current_version_id='old-v1' WHERE id='old';
   INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status)
     VALUES ('p1','t1','old','old-v1','a1','create','key','snapshot','ready');
   INSERT INTO hq_template_distribution_runs(id,tenant_id,template_id,template_version_id,idempotency_fingerprint,status) VALUES ('r1','t1','old','old-v1','run-key','completed');
   INSERT INTO hq_template_distribution_results(run_id,tenant_id,template_id,template_version_id,target_account_id,preflight_id,idempotency_fingerprint,snapshot_token,status)
     VALUES ('r1','t1','old','old-v1','a1','p1','key','snapshot','succeeded');`);
  const tables=['hq_templates','hq_template_versions','hq_template_preflights','hq_template_distribution_runs','hq_template_distribution_results'];
  const before=tables.map(t=>previous.prepare(`SELECT * FROM ${t}`).all());
  previous.exec(readFileSync(new URL('../migrations/622_hq_delivery_templates.sql',import.meta.url),'utf8'));
  expect(tables.map(t=>previous.prepare(`SELECT * FROM ${t}`).all())).toEqual(before.map((rows,i)=>i===0?rows.map(row=>({...row as object,delivery_type:null})):rows));
  for(const type of ['auto_reply','friend_add_rule','reminder'] as const) {
   expect((await createHqTemplate(asD1(previous),{id:type,tenantId:'t1',type,name:type})).template_type).toBe(type);
  }
  expect(previous.pragma('foreign_key_check')).toEqual([]);
 } finally { previous.close(); }
});
