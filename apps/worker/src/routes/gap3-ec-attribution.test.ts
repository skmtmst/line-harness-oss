import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {ecAutoLine} from './ec-auto-line.js';
import {simulateAttribution,simulationResults} from '../features/ec-commerce/ec-auto-line-attribution.js';
let d:ReturnType<typeof gapFixture>;const now=new Date('2026-10-18T00:00:00Z');
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('e','a','f','cart_add','p','{}','2026-10-16T00:00:00Z','now','e');INSERT INTO ec_auto_line_sends(id,account_id,friend_id,rule_kind,product_id,trigger_event_id,scheduled_at,original_due_at,messages_snapshot_json,status,sent_at) VALUES('send','a','f','cart','p','e','now','now','[]','simulated','2026-10-16T03:00:00Z')");});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
const click={sendId:'send',friendId:'f',kind:'click',eventId:'click1',occurredAt:'2026-10-16T03:05:00Z',testMode:true};
const order={...click,kind:'purchase',eventId:'order1',orderId:'order',amount:3000,occurredAt:'2026-10-16T04:00:00Z'};
test('EC-21/23: 7日内のリンク経由だけ、再送は1回、模擬成果と実績を分ける',async()=>{
 await expect(simulateAttribution(d.db,'a',order,now)).rejects.toMatchObject({code:'link_required_or_duplicate_order'});
 await simulateAttribution(d.db,'a',click,now);expect(await simulateAttribution(d.db,'a',click,now)).toMatchObject({replayed:true});await simulateAttribution(d.db,'a',order,now);
 await expect(simulateAttribution(d.db,'a',{...order,eventId:'order2'},now)).rejects.toMatchObject({code:'link_required_or_duplicate_order'});
 expect(await simulationResults(d.db,'a')).toEqual({clickedMessages:1,purchases:1,purchaseAmount:3000});const r=await gapCall(gapApp(d,[ecAutoLine]),'/api/ec/auto-line/stats?account_id=a');expect((await r.json() as any).data).toMatchObject({sent:0,clicks:null,purchases:null,simulatedResults:{clickedMessages:1,purchases:1,purchaseAmount:3000}});
});
test('EC-21: 他人・他店・送信前・8日後・同キー別内容・liveを拒否',async()=>{
 for(const [a,b,code] of [['b',click,'send_not_found'],['a',{...click,friendId:'f2'},'send_not_found'],['a',{...click,occurredAt:'2026-10-16T02:59:00Z'},'attribution_window_closed'],['a',{...click,occurredAt:'2026-10-24T00:00:00Z'},'attribution_window_closed'],['a',{...click,testMode:false},'test_mode_required']] as const)await expect(simulateAttribution(d.db,a,b,new Date('2026-10-25T00:00:00Z'))).rejects.toMatchObject({code});
 await simulateAttribution(d.db,'a',click,now);await expect(simulateAttribution(d.db,'a',{...click,occurredAt:'2026-10-16T03:06:00Z'},now)).rejects.toMatchObject({code:'idempotency_conflict'});
});
test('EC-18/19/20: 成果の模擬書込は閲覧のみ・担当・代理に許可しない',async()=>{
 for(const [staff,im] of [[{...gapOwner,readOnly:true},false],[{...gapOwner,role:'staff' as const},false],[gapOwner,true]] as const)expect((await gapCall(gapApp(d,[ecAutoLine],staff,im),'/api/ec/auto-line/attribution/simulate?account_id=a','POST',click)).status).toBe(403);
});
