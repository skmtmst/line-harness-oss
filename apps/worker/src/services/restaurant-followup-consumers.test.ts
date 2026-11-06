import { afterEach, expect, it, vi } from 'vitest';
import { publishScenarioVersion } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { seedExistingRestaurantFollowup } from '../test-utils/restaurant-followup-fixture.js';
import { requestRestaurantFollowupApproval } from './restaurant-followup.js';
import { processRestaurantEvents } from './restaurant-events.js';
import * as targets from './restaurant-reminder-targets.js';
import type { Env } from '../worker-env.js';
afterEach(()=>vi.restoreAllMocks());
it('新しい接続が失敗しても、旧方式の承認済みの店は予定を作り続ける',async()=>{
 const t=createTestD1({foreignKeys:true});
 try {
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
   INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
   INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
   INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店舗','S','a');`);
  seedExistingRestaurantFollowup(t,'s');
  await publishScenarioVersion(t.db,'restaurant-followup:s',{staffId:null,idempotencyKey:crypto.randomUUID()});
  const {template_version}=t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as {template_version:number};
  const approval=await requestRestaurantFollowupApproval(t.db,'s',template_version,'owner');
  t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(approval!.id);
  t.raw.exec(`INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
    VALUES('r','s','line','友だち','UID',2,'2099-11-02T10:00:00Z','2099-11-02T11:00:00Z','confirmed');
    UPDATE rt_reservation_event_receipts SET status='succeeded' WHERE consumer_key NOT IN('followup','followup_targets');`);
  vi.spyOn(targets,'syncRestaurantReminderTargets').mockRejectedValue(new Error('new_connection_failed'));
  await processRestaurantEvents({DB:t.db,DEPLOY_ENV:'test',RESTAURANT_TEST_ENABLED:'true'} as Env['Bindings']);
  expect(t.raw.prepare('SELECT COUNT(*) n FROM scenario_source_jobs').get()).toEqual({n:3});
  expect(t.raw.prepare("SELECT consumer_key,status FROM rt_reservation_event_receipts WHERE consumer_key IN('followup','followup_targets') ORDER BY consumer_key").all()).toEqual([
   {consumer_key:'followup',status:'succeeded'},{consumer_key:'followup_targets',status:'failed'},
  ]);
 } finally {t.raw.close()}
});

it('未知の受取先を汎用の出来事へ流さない',async()=>{
 const t=createTestD1();
 try {
  const bus=await import('./event-bus.js');const fire=vi.spyOn(bus,'fireEvent').mockResolvedValue(undefined);
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
   INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
   INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
   INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店','S','a');
   INSERT INTO rt_reservation_events(id,store_id,event_type,reservation_version,occurred_at,request_id,payload_json,line_account_id,friend_id) VALUES('e','s','restaurant.reservation.created',1,'2026-10-30T10:00:00Z','req','{}','a','f');
   UPDATE rt_reservation_event_receipts SET status='succeeded';
   INSERT INTO rt_reservation_event_receipts(event_id,consumer_key) VALUES('e','unknown');`);
  await processRestaurantEvents({DB:t.db,DEPLOY_ENV:'test',RESTAURANT_TEST_ENABLED:'true'} as Env['Bindings']);
  expect(fire.mock.calls.length).toBe(0);
  expect(t.raw.prepare("SELECT status FROM rt_reservation_event_receipts WHERE consumer_key='unknown'").get()).toEqual({status:'failed'});
 } finally {t.raw.close()}
});
