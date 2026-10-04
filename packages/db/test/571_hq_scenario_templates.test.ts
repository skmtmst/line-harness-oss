import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createHqTemplate, getHqTemplate, listHqTemplates } from '../src/hq-templates.js';
import { asD1 } from './d1-test-helper.js';
test('571 preserves existing templates and versions and exposes the logical scenario type', async()=>{
 const sql=new Database(':memory:');
 try {
  sql.exec(readFileSync(new URL('../migrations/381_hq_templates.sql',import.meta.url),'utf8'));
  sql.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('old','t','template','既存'); INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('v','t','old',1,'{}','fixture')");
  sql.exec(readFileSync(new URL('../migrations/571_hq_scenario_templates.sql',import.meta.url),'utf8'));
  const db=asD1(sql);
  expect((await createHqTemplate(db,{id:'new',tenantId:'t',type:'scenario',name:'案内'})).template_type).toBe('scenario');
  expect((await getHqTemplate(db,'t','old'))?.template_type).toBe('template');
  expect((await listHqTemplates(db,'t','scenario')).map(t=>t.id)).toEqual(['new']);
  expect(sql.prepare("SELECT id FROM hq_template_versions WHERE template_id='old'").get()).toEqual({id:'v'});
  expect(()=>sql.exec("UPDATE hq_templates SET extended_type='scenario' WHERE id='old'")).toThrow('HQ_TYPE_IMMUTABLE');
 } finally {sql.close()}
});
