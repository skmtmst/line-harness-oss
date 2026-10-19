import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
test('572 retains preflights and makes the confirmed per-account text immutable',()=>{
 const sql=new Database(':memory:');try {
  sql.exec(readFileSync(new URL('../migrations/381_hq_templates.sql',import.meta.url),'utf8'));
  sql.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('t','tenant','template','案内'); INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('v','tenant','t',1,'{}','fixture'); INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status) VALUES ('old','tenant','t','v','a','create','r','s','ready')");
  sql.exec(readFileSync(new URL('../migrations/572_hq_template_text_overrides.sql',import.meta.url),'utf8'));
  expect(sql.prepare("SELECT text_override FROM hq_template_preflights WHERE id='old'").get()).toEqual({text_override:null});
  expect(()=>sql.exec("UPDATE hq_template_preflights SET text_override='changed' WHERE id='old'")).toThrow('HQ_TEXT_OVERRIDE_IMMUTABLE');
  expect(()=>sql.exec("INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,text_override) VALUES ('new','tenant','t','v','a','create','r2','s','ready','')")).toThrow();
 }finally{sql.close()}
});
