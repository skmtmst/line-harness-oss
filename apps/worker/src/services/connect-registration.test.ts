import { afterEach,beforeEach,expect,test } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { applyRegistrationOptions,validateRegistrationOptions } from './connect-registration.js';
let sql:Database.Database,db:D1Database;
beforeEach(()=>{
 const f=createTestD1({foreignKeys:true});sql=f.raw;db=f.db;
 sql.exec("INSERT INTO tenants(id,name) VALUES ('t','試験'),('other','別'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('a','親','test-a','fixture','fixture','t'),('b','子','test-b','fixture','fixture','t'); INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope) VALUES ('owner','管理','owner','fixture-owner','t','all'),('s','担当','staff','fixture-staff','t','accounts'),('outside','他社','staff','fixture-outside','other','accounts'); INSERT INTO line_account_tags(id,tenant_id,name,created_at,updated_at) VALUES ('tag','t','分類','fixture','fixture'),('other-tag','other','別分類','fixture','fixture')");
});
afterEach(()=>sql.close());
test('persists tags and scopes atomically, bumps policy, audits, and rejects tenant and hierarchy changes',async()=>{
 const options=await validateRegistrationOptions(db,'t',{tagIds:['tag'],staffIds:['s'],parentLineAccountId:'a'},'owner');
 sql.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,parent_line_account_id) VALUES ('registered','新規','test-registered','fixture','fixture','t','a')");
 await applyRegistrationOptions(db,'registered','owner',options);
 expect(sql.prepare('SELECT line_account_id,tag_id FROM line_account_tag_links').all()).toEqual([{line_account_id:'registered',tag_id:'tag'}]);
 expect(sql.prepare('SELECT staff_id,line_account_id FROM staff_account_scopes').all()).toEqual([{staff_id:'s',line_account_id:'registered'}]);
 expect(sql.prepare("SELECT policy_version FROM staff_members WHERE id='s'").get()).toEqual({policy_version:2});
 expect((sql.prepare('SELECT COUNT(*) n FROM audit_events').get() as {n:number}).n).toBe(2);
 await expect(validateRegistrationOptions(db,'t',{tagIds:['other-tag']},'owner')).rejects.toMatchObject({status:403});
 await expect(validateRegistrationOptions(db,'t',{staffIds:['outside']},'owner')).rejects.toMatchObject({status:403});
 await expect(validateRegistrationOptions(db,'t',{tagIds:['tag']},'s')).rejects.toMatchObject({status:403});
 sql.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,parent_line_account_id) VALUES ('c','孫','test-c','fixture','fixture','t','b'); UPDATE line_accounts SET parent_line_account_id='a' WHERE id='b'");
 await expect(validateRegistrationOptions(db,'t',{parentLineAccountId:'c'},'owner')).rejects.toMatchObject({code:'INVALID_ACCOUNT_HIERARCHY'});
});
test('a staff policy change between check and save rolls back tag and scope writes',async()=>{
 const checked=await validateRegistrationOptions(db,'t',{tagIds:['tag'],staffIds:['s']},'owner');
 sql.exec("UPDATE staff_members SET policy_version=2 WHERE id='s'");
 await expect(applyRegistrationOptions(db,'b','owner',checked)).rejects.toMatchObject({status:409});
 expect(sql.prepare('SELECT * FROM line_account_tag_links').all()).toEqual([]);
 expect(sql.prepare('SELECT * FROM staff_account_scopes').all()).toEqual([]);
 expect(sql.prepare('SELECT * FROM audit_events').all()).toEqual([]);
});
