import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { runBookingExternalStep } from './booking-external-step.js';
import { BookingExternalCircuits } from './booking-external-circuits.js';
import { API_RETRY_WAIT } from '../../lib/external-call/index.js';
let mf:Miniflare,db:D1Database;
const now=Date.parse('2026-10-18T00:00:00Z');
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:['DB']});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  const migration=readFileSync(new URL('../../../../../packages/db/migrations/615_workflow_steps.sql',import.meta.url),'utf8').split('-- Banner-specific')[0];
  await db.prepare(migration).run();
  await db.prepare('CREATE TABLE business_result(id TEXT PRIMARY KEY)').run();
},30000);
afterAll(async()=>{await mf?.dispose();});
it('実D1でも送信前CASは同時1件。結果保存の取引が落ちるとstartedを保持して再送0',async()=>{
  let operation='parallel';
  const execute=vi.fn(async()=>({kind:'success' as const,value:{id:'provider-id'}}));
  const input=()=>({ref:{scopeId:'line:a',processKind:'booking_fixture',subjectId:operation,stepKey:'send'},
    identity:{scope:{accountId:'a',storeId:'a',destination:'fixture',connectionId:'c'},operationId:operation,
      idempotencyKey:operation,snapshotId:operation,effect:'write' as const},
    policy:{category:'api' as const,maxAttempts:1,timeoutMs:1000,deadlineAt:now+600000,wait:API_RETRY_WAIT},
    snapshot:{body:'saved'},now:()=>now,authorize:async()=>true,execute,
    statements:(next:{phase:string})=>next.phase==='succeeded'?[db.prepare('INSERT INTO business_result VALUES(?)').bind(operation)]:[],
  });
  const results=await Promise.all([runBookingExternalStep(db,input()),runBookingExternalStep(db,input())]);
  expect(results.map(r=>r.kind)).toContain('success');expect(execute).toHaveBeenCalledTimes(1);
  expect(await db.prepare('SELECT COUNT(*) n FROM business_result').first()).toEqual({n:1});
  operation='crash';
  await db.prepare("CREATE TRIGGER crash_result BEFORE INSERT ON business_result BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  expect((await runBookingExternalStep(db,input())).kind).toBe('unknown');
  await db.prepare('DROP TRIGGER crash_result').run();
  expect((await runBookingExternalStep(db,input())).kind).toBe('unknown');expect(execute).toHaveBeenCalledTimes(2);
  expect(await db.prepare('SELECT COUNT(*) n FROM business_result').first()).toEqual({n:1});
});
it('実D1の共有遮断でもopen中0・半開同時1、別の接続は止めない',async()=>{
  const a=new BookingExternalCircuits(db),b=new BookingExternalCircuits(db),scope={accountId:'b',storeId:'b',destination:'fixture',connectionId:'c'};
  for(let n=0;n<5;n++){const admission=await a.acquire(scope,now);expect(admission.allowed).toBe(true);if(admission.allowed)await a.settle(admission.lease,'failure',now);}
  expect((await b.acquire(scope,now)).allowed).toBe(false);
  const probes=await Promise.all([a.acquire(scope,now+30000),b.acquire(scope,now+30000)]);
  expect(probes.filter(p=>p.allowed)).toHaveLength(1);
  expect((await b.acquire({...scope,connectionId:'other'},now)).allowed).toBe(true);
});
