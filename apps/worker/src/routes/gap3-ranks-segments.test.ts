import {beforeEach,afterEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner,seedGapBooking} from '../test-utils/gap1.js';
import {customerSegments} from './customer-segments.js';
import {memberRanks} from './member-ranks.js';
import {refreshCustomerSegments} from '../services/customer-segments.js';
import {evaluateRanks} from '../services/member-ranks.js';
import {buildSegmentQuery} from '@line-crm/db/src/segment-conditions.js';
let d:ReturnType<typeof gapFixture>;
const now=new Date('2026-10-16T04:00:00Z');
beforeEach(()=>{d=gapFixture();});afterEach(()=>{d.raw.close();vi.restoreAllMocks();});
const app=()=>gapApp(d,[customerSegments,memberRanks]);
async function data(path:string,method='GET',b?:unknown,key?:string){const r=await gapCall(app(),path,'GET'===method?'GET':method,b,key);const json=await r.json() as any;expect(r.status,JSON.stringify(json)).toBeLessThan(300);return json.data;}
function visit(id:string='v',at='2026-10-15T04:00:00Z'){seedGapBooking(d,id,'confirmed',at);d.raw.prepare("INSERT INTO booking_visit_marks(id,booking_id,line_account_id,kind,marked_by_staff_id,marked_at) VALUES(?,?,'a','visited','o',?)").run('mark-'+id,id,at);}
test('RFM-01/02/08/10: 25マス＋表外が全員、宣伝停止の人数、集計失敗後も前回の数',async()=>{
 const external=vi.spyOn(globalThis,'fetch');visit();d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人','liff')");
 await refreshCustomerSegments(d.db,'a',now);const result=await data('/api/analytics/customer-segments?account_id=a&basis=visit');
 expect(result.cells).toHaveLength(25);expect(result.total).toBe(2);expect(result.outside.count).toBe(1);expect(result.cells.find((c:{r:number;f:number})=>c.r===1&&c.f===1)).toMatchObject({count:1,optedOutCount:1});
 const list=await data('/api/analytics/customer-segments/cells/1/1/friends?account_id=a&basis=visit');expect(list.total).toBe(1);expect(list.items[0].id).toBe('f');expect(list.optedOutCount).toBe(1);
 d.raw.exec("UPDATE customer_activity_runs SET status='failed'");expect((await data('/api/analytics/customer-segments?account_id=a&basis=visit')).status).toBe('failed');
 expect((await gapCall(gapApp(d,[customerSegments],{...gapOwner,readOnly:true}),'/api/analytics/customer-segments/cells/1/1/name?account_id=a','PUT',{name:'名前'})).status).toBe(403);expect(external).not.toHaveBeenCalled();
});
test('RFM-04/11: 保存した検索は集計の最新のマスを読み、来店数の条件と一致する',async()=>{
 visit();await refreshCustomerSegments(d.db,'a',now);
 const saved=await data('/api/analytics/customer-segments/cells/1/1/saved-search?account_id=a','POST',{name:'新しい人',basis:'visit'});
 const query=buildSegmentQuery({operator:'AND',rules:[{type:'customer_segment',value:{r:1,f:1,basis:'visit'}}]});expect(d.raw.prepare(query.sql).all(...query.bindings)).toHaveLength(1);
 expect(JSON.stringify(saved)).toContain('customer_segment');visit('v2');await refreshCustomerSegments(d.db,'a',now);expect(d.raw.prepare(query.sql).all(...query.bindings)).toHaveLength(0);
 const q=buildSegmentQuery({operator:'AND',rules:[{type:'visit_count',value:{min:2}}]});expect(d.raw.prepare(q.sql).all(...q.bindings)).toHaveLength(1);
});
async function configure(){
 await data('/api/member-ranks/program?account_id=a','PUT',{metric:'visits',windowMonths:6,expectedVersion:0});
 await data('/api/member-ranks/tiers?account_id=a','PUT',{expectedVersion:1,tiers:[{id:'regular',name:'レギュラー',threshold:0,mileMultiplier:1},{id:'silver',name:'シルバー',threshold:1,mileMultiplier:1.5}]});
}
test('RANK-01/03/04/09/10: 最初は通知0・二重適用なし、低下は14日猶予・回復で解除',async()=>{
 visit();await configure();const external=vi.spyOn(globalThis,'fetch');const path='/api/member-ranks/activate?account_id=a';
 const first=await data(path,'POST',{expectedVersion:2},'activate');expect(first.status).toBe('active');
 await data(path,'POST',{expectedVersion:2},'activate');expect(d.raw.prepare('SELECT count(*) n FROM member_rank_history').get()).toEqual({n:2});
 expect(d.raw.prepare("SELECT tier_id FROM member_ranks WHERE friend_id='f'").get()).toEqual({tier_id:'silver'});expect(d.raw.prepare('SELECT SUM(notified) n FROM member_rank_history').get()).toEqual({n:0});
 await evaluateRanks(d.db,'a',false,new Date('2027-06-01T04:00:00Z'));expect(d.raw.prepare("SELECT tier_id,downgrade_due_at FROM member_ranks WHERE friend_id='f'").get()).toEqual({tier_id:'silver',downgrade_due_at:'2027-06-15T04:00:00.000Z'});
 await evaluateRanks(d.db,'a',false,new Date('2027-06-10T04:00:00Z'));expect(d.raw.prepare("SELECT tier_id FROM member_ranks WHERE friend_id='f'").get()).toEqual({tier_id:'silver'});
 visit('again','2027-06-10T03:00:00Z');await evaluateRanks(d.db,'a',false,new Date('2027-06-10T04:10:00Z'));expect(d.raw.prepare("SELECT downgrade_due_at FROM member_ranks WHERE friend_id='f'").get()).toEqual({downgrade_due_at:null});expect(external).not.toHaveBeenCalled();
 expect((await gapCall(app(),'/api/member-ranks/program?account_id=a','PUT',{metric:'amount',windowMonths:6,expectedVersion:0})).status).toBe(409);
});
test('RANK-08/09/17: 逆転する段・代理・他店を拒否し、段の編集を繰り返しても履歴を保つ',async()=>{
 await configure();expect((await gapCall(app(),'/api/member-ranks/tiers?account_id=a','PUT',{expectedVersion:2,tiers:[{id:'regular',name:'下',threshold:1,mileMultiplier:1},{id:'silver',name:'上',threshold:0,mileMultiplier:1}]})).status).toBe(400);
 for(const v of [2,3,4])await data('/api/member-ranks/tiers?account_id=a','PUT',{expectedVersion:v,tiers:[{id:'regular',name:'下',threshold:0,mileMultiplier:1},{id:'gold',name:'上',threshold:3,mileMultiplier:1}]});
 expect((await gapCall(gapApp(d,[memberRanks],gapOwner,true),'/api/member-ranks/activate?account_id=a','POST',{expectedVersion:5})).status).toBe(403);
 expect((await gapCall(app(),'/api/member-ranks/program?account_id=b')).status).toBe(404);
});

test('RFM-08: 作り直しの途中失敗は昨日の人数と時点を保持してから失敗を記録',async()=>{
 const {processCustomerSegments}=await import('../services/customer-segments.js');visit();await refreshCustomerSegments(d.db,'a',new Date('2026-10-15T00:00:00Z'));
 const before=d.raw.prepare('SELECT * FROM customer_activity_daily ORDER BY account_id,friend_id,basis').all();
 d.raw.exec("CREATE TRIGGER fail_rebuild BEFORE INSERT ON customer_activity_daily BEGIN SELECT RAISE(ABORT,'rebuild failure'); END");
 await expect(processCustomerSegments(d.db,now)).rejects.toThrow('rebuild failure');expect(d.raw.prepare('SELECT * FROM customer_activity_daily ORDER BY account_id,friend_id,basis').all()).toEqual(before);
 expect(d.raw.prepare('SELECT computed_at,status FROM customer_activity_runs').get()).toEqual({computed_at:'2026-10-15T00:00:00.000Z',status:'failed'});
});
test('RANK-01/10/19: 初回判定の途中失敗では動作中の印・タグ・履歴を一切残さず再試行可能',async()=>{
 visit();await configure();d.raw.exec("CREATE TRIGGER fail_rank BEFORE INSERT ON member_rank_history BEGIN SELECT RAISE(ABORT,'rank failure'); END");
 expect((await gapCall(app(),'/api/member-ranks/activate?account_id=a','POST',{expectedVersion:2},'activate')).status).toBe(503);
 expect(d.raw.prepare('SELECT status,version FROM member_rank_programs').get()).toEqual({status:'stopped',version:2});expect(d.raw.prepare('SELECT count(*) n FROM member_ranks').get()).toEqual({n:0});
 d.raw.exec('DROP TRIGGER fail_rank');await data('/api/member-ranks/activate?account_id=a','POST',{expectedVersion:2},'activate');expect(d.raw.prepare('SELECT count(*) n FROM member_rank_mutations').get()).toEqual({n:1});
});

test('RFM-01: 365日より前の最終来店も残し、来店したことがない人と混ぜない',async()=>{
 visit('old','2025-01-01T00:00:00Z');await refreshCustomerSegments(d.db,'a',now);const result=await data('/api/analytics/customer-segments?account_id=a&basis=visit');
 expect(result.outside.count).toBe(1);expect(result.cells.find((c:{r:number;f:number})=>c.r===5&&c.f===1).count).toBe(1);
 expect(d.raw.prepare("SELECT activity_count,last_activity_at FROM customer_activity_daily WHERE account_id='a' AND friend_id='f' AND basis='visit'").get()).toEqual({activity_count:0,last_activity_at:'2025-01-01T00:00:00Z'});
});
