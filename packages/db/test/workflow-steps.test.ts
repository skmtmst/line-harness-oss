import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { claimWorkflowStep,ensureWorkflowStep,failWorkflowStep,finishWorkflowStep,getWorkflowStep,workflowJson } from '../src/workflow-steps.js';
let raw: Database.Database,db:D1Database;
const ref={scopeId:'line:a',processKind:'event_reminder',subjectId:'r',stepKey:'send'};
beforeEach(()=>{raw=new Database(':memory:');raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));db=asD1(raw)});
afterEach(()=>raw.close());
describe('shared workflow checkpoints',()=>{
 it('active lease excludes a second sender; expired owner cannot finish or fail new work',async()=>{
  await ensureWorkflowStep(db,ref,{now:100,input:{text:'original'}});
  const first=await claimWorkflowStep(db,ref,{now:100,leaseMs:100});
  expect(await claimWorkflowStep(db,ref,{now:150})).toBeNull();
  const second=await claimWorkflowStep(db,ref,{now:201});
  expect(second!.retry_key).toBe(first!.retry_key);
  await expect(finishWorkflowStep(db,ref,first!.lease_owner!,{now:202})).rejects.toThrow();
  await failWorkflowStep(db,ref,first!.lease_owner!,{now:202});
  expect((await getWorkflowStep(db,ref))!.lease_owner).toBe(second!.lease_owner);
  await finishWorkflowStep(db,ref,second!.lease_owner!,{now:202,result:{sent:true}});
  expect(await claimWorkflowStep(db,ref,{now:203})).toBeNull();
 });
 it('immutable snapshot and key survive edits, backoff and bounded failures',async()=>{
  const first=await ensureWorkflowStep(db,ref,{now:10,maxAttempts:2,input:{text:'old'}});
  await ensureWorkflowStep(db,ref,{now:11,input:{text:'new'}});
  const one=await claimWorkflowStep(db,ref,{now:12});
  await failWorkflowStep(db,ref,one!.lease_owner!,{now:13,delayMs:100,code:'provider_unavailable'});
  expect(await claimWorkflowStep(db,ref,{now:112})).toBeNull();
  const two=await claimWorkflowStep(db,ref,{now:113});
  expect(two!.input_json).toBe(first.input_json);
  await failWorkflowStep(db,ref,two!.lease_owner!,{now:114});
  expect((await getWorkflowStep(db,ref))!.status).toBe('exhausted');
  expect(await claimWorkflowStep(db,ref,{now:999999})).toBeNull();
 });
 it('domain mutation and checkpoint roll back together on storage failure',async()=>{
  raw.exec('CREATE TABLE counter(n INTEGER); INSERT INTO counter VALUES(0)');
  await ensureWorkflowStep(db,ref,{now:1});const one=await claimWorkflowStep(db,ref,{now:1});
  raw.exec("CREATE TRIGGER broken_checkpoint BEFORE UPDATE OF result_json ON workflow_steps BEGIN SELECT RAISE(ABORT,'storage failure'); END");
  await expect(finishWorkflowStep(db,ref,one!.lease_owner!,{now:2,statements:[db.prepare('UPDATE counter SET n=n+1')]})).rejects.toThrow();
  expect(raw.prepare('SELECT n FROM counter').get()).toEqual({n:0});
  raw.exec('DROP TRIGGER broken_checkpoint');
  await finishWorkflowStep(db,ref,one!.lease_owner!,{now:2,statements:[db.prepare('UPDATE counter SET n=n+1')]});
  expect(raw.prepare('SELECT n FROM counter').get()).toEqual({n:1});
 });
 it('separates account scopes and rejects credentials in snapshots',async()=>{
  await ensureWorkflowStep(db,ref);await ensureWorkflowStep(db,{...ref,scopeId:'line:b'});
  expect(await claimWorkflowStep(db,ref)).toBeTruthy();expect(await claimWorkflowStep(db,{...ref,scopeId:'line:b'})).toBeTruthy();
  expect(()=>workflowJson({channelAccessToken:'secret'})).toThrow();
 });
});
