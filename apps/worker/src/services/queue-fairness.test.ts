import { afterEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processVisitStampQueue } from './visit-stamps.js';
import { processRestaurantEvents } from './restaurant-events.js';
import { ensureWorkflowStep } from '@line-crm/db';
afterEach(() => vi.restoreAllMocks());
test('SCALE-04 失敗する先頭100件を後ろへ回し、次の店の来店を処理する', async () => {
 const f=createTestD1();
 try {
  const add=f.raw.prepare("INSERT INTO visit_stamp_visit_queue(kind,visit_id,updated_at) VALUES('booking',?,?)");
  for(let i=0;i<101;i++) add.run(`job${i}`,i<100?'2026-01-01':'2026-01-02');
  const original=f.db.prepare.bind(f.db);
  vi.spyOn(f.db,'prepare').mockImplementation(sql=>{
   const statement=original(sql);
   if(sql.startsWith('SELECT id,line_account_id AS account_id')) {
    const bind=statement.bind.bind(statement);
    statement.bind=(...args:unknown[])=>{ if(args[0]!=='job100') throw new Error('synthetic bad visit'); return bind(...args); };
   }
   return statement;
  });
  vi.spyOn(console,'error').mockImplementation(()=>{});
  await processVisitStampQueue({DB:f.db} as any); await processVisitStampQueue({DB:f.db} as any);
  expect(f.raw.prepare("SELECT visit_id FROM visit_stamp_visit_queue WHERE visit_id='job100'").get()).toBeUndefined();
 } finally {f.raw.close();}
});
test('SCALE-04 上限まで失敗した100件で後ろの飲食店イベントをふさがない', async () => {
 const f=createTestD1();
 try {
  f.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','人工組織');INSERT INTO rt_stores(id,organization_id,name,code) VALUES('store','org','人工店','S')");
  for(let i=0;i<101;i++) {
   const id=`event${i}`;
   f.raw.prepare("INSERT INTO rt_reservation_events(id,store_id,event_type,reservation_version,occurred_at,request_id,payload_json) VALUES(?,'store','visit',1,?,?,'{}')").run(id,i<100?'2026-01-01':'2026-01-02',id);
   f.raw.prepare("DELETE FROM rt_reservation_event_receipts WHERE event_id=? AND consumer_key<>'mileage'").run(id);
   f.raw.prepare("UPDATE rt_reservation_event_receipts SET status='failed',attempt_count=? WHERE event_id=? AND consumer_key='mileage'").run(i<100?50:0,id);
   if(i<100){
    await ensureWorkflowStep(f.db,{scopeId:'store',processKind:'restaurant_event',subjectId:id+':mileage',stepKey:'__run'},{maxAttempts:50});
    f.raw.prepare("UPDATE workflow_steps SET status='exhausted',attempt_count=50 WHERE subject_id=?").run(id+':mileage');
   }
  }
  await processRestaurantEvents({DB:f.db,RESTAURANT_TEST_ENABLED:'true'} as any);
  expect(f.raw.prepare("SELECT status FROM rt_reservation_event_receipts WHERE event_id='event100'").get()).toEqual({status:'succeeded'});
 } finally {f.raw.close();}
});
