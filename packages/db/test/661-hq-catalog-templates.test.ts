import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {createHqTemplate,listHqTemplates} from '../src/hq-templates.js';
import {asD1} from './d1-test-helper.js';
test('661は旧列・制約・固定版を保って予約メニューと景品だけ追加する',async()=>{
 const db=new Database(':memory:');try{
 for(const file of ['381_hq_templates.sql','571_hq_scenario_templates.sql','612_hq_friend_attribute_templates.sql','622_hq_delivery_templates.sql'])db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 db.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES('old','t','tag','既存'); INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES('v','t','old',1,'{}','h')");
 const old=db.prepare('SELECT * FROM hq_templates').all(),version=db.prepare('SELECT * FROM hq_template_versions').all();
 db.exec(readFileSync(new URL('../migrations/661_hq_catalog_templates.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT * FROM hq_templates').all()).toEqual(old.map(r=>({...r as object,catalog_type:null})));
 expect(db.prepare('SELECT * FROM hq_template_versions').all()).toEqual(version);
 for(const type of ['booking_menu','mileage_reward'] as const){
  expect((await createHqTemplate(asD1(db),{id:type,tenantId:'t',type,name:type})).template_type).toBe(type);
  expect((await listHqTemplates(asD1(db),'t',type)).map(r=>r.id)).toEqual([type]);
 }
 for(const sql of ["UPDATE hq_templates SET catalog_type='mileage_reward' WHERE id='old'","UPDATE hq_templates SET delivery_type='reminder' WHERE id='booking_menu'","UPDATE hq_templates SET catalog_type=NULL WHERE id='mileage_reward'","INSERT INTO hq_templates(id,tenant_id,template_type,catalog_type,name) VALUES('bad','t','tag','booking_menu','bad')"] )expect(()=>db.exec(sql)).toThrow();
 expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close();}
});
