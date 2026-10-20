import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture} from '../test-utils/gap1.js';
import {deleteCustomerData} from '../services/customer-data-deletion.js';
import {passCheckout,passBillingEvent} from '../features/booking/booking-pass-billing.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();d.raw.pragma("foreign_keys=ON");vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
test('GAP3-DELETE-01: 本人の通知・購入・成果だけ削除し、匿名化した券・店設定・他の人は残す',async()=>{
 const now=new Date(),at=now.toISOString(),end=new Date(now.getTime()+30*86400000).toISOString();
 d.raw.prepare("INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,valid_days,status,created_by,created_at,idempotency_key,request_json) VALUES('plan','a','ticket','券',3000,10,180,'on_sale','o',?,'plan','{}')").run(at);
 for(const f of ['f','f2']){
 const p=await passCheckout(d.db,'a',f,'plan','buy-'+f,true,now);await passBillingEvent(d.db,{id:'checkout-'+f,kind:'checkout.session.completed',checkoutId:String(p.checkoutId),amount:3000,currency:'jpy',periodStart:at,periodEnd:end,occurredAt:at,testMode:true},now);
 }
 d.raw.exec("INSERT INTO tags(id,name,line_account_id,manual_assignment_allowed) VALUES('rank-tag','会員','a',0);INSERT INTO member_rank_programs(account_id,updated_at) VALUES('a','now');INSERT INTO member_rank_tiers(id,account_id,sort,name,threshold,tag_id) VALUES('tier','a',0,'一般',0,'rank-tag')");
 for(const f of ['f','f2']){
 d.raw.prepare("INSERT INTO booking_entitlement_notices(id,line_account_id,friend_id,entitlement_id,plan_id,kind,dedupe_key,messages_json,scheduled_at) SELECT ?,'a',?,id,'plan','expiry_14_days','key','[]',? FROM booking_entitlements WHERE friend_id=?").run('pass-notice-'+f,f,at,f);
 d.raw.prepare("INSERT INTO member_ranks(account_id,friend_id,tier_id,since) VALUES('a',?,'tier',?)").run(f,at);
 d.raw.prepare("INSERT INTO member_rank_notices(id,account_id,friend_id,change_key,kind,tier_id,purpose,messages_json,base_messages_json,scheduled_at) VALUES(?,'a',?,?,'upgrade','tier','notice','[]','[]',?)").run('notice-'+f,f,'key-'+f,at);
 d.raw.prepare("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES(?,'a',?,'cart_add','p','{}',?,?,?)").run('event-'+f,f,at,at,'event-'+f);
 d.raw.prepare("INSERT INTO ec_auto_line_sends(id,account_id,friend_id,rule_kind,product_id,trigger_event_id,scheduled_at,original_due_at,messages_snapshot_json,status,sent_at) VALUES(?,'a',?,'cart','p',?,?,?,'[]','simulated',?)").run('send-'+f,f,'event-'+f,at,at,at);
 d.raw.prepare("INSERT INTO ec_auto_line_attribution_events(id,account_id,send_id,friend_id,kind,external_event_id,occurred_at,request_json) VALUES(?,'a',?,?,'click',?,?,'{}')").run('click-'+f,'send-'+f,f,'click-'+f,at);
 }
 expect(await deleteCustomerData({DB:d.db},{kind:'friend_data',id:'f',friendId:'f',accountId:'a',lineUserId:'Uf'},'o')).toMatchObject({deleted:true});
 for(const table of ['booking_entitlement_notices','member_rank_notices','member_ranks','ec_behavior_events','ec_auto_line_sends','ec_auto_line_attribution_events','booking_pass_purchases'])expect(d.raw.prepare(`SELECT friend_id FROM ${table}`).all(),table).toEqual([{friend_id:'f2'}]);
 expect(d.raw.prepare('SELECT count(*) n FROM booking_pass_billing_events').get()).toEqual({n:1});expect(d.raw.prepare('SELECT friend_id FROM booking_entitlements ORDER BY friend_id').all()).toEqual([{friend_id:null},{friend_id:'f2'}]);
 expect(d.raw.prepare('SELECT count(*) n FROM member_rank_tiers').get()).toEqual({n:1});expect(d.raw.prepare('SELECT count(*) n FROM booking_pass_plans').get()).toEqual({n:1});
});
