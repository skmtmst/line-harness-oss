import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,seedGapBooking} from '../test-utils/gap1.js';
import {memberRanks} from './member-ranks.js';
import {friends} from './friends.js';
import {refreshCustomerSegments} from '../services/customer-segments.js';
import {buildSegmentQuery} from '@line-crm/db/src/segment-conditions.js';
vi.mock('./booking.js',async original=>({...await original<any>(),resolveAccountIdFromLiff:async(c:any)=>c.req.query('liffId')==='liff-a'?'a':null,verifyCallerLineUserId:async(c:any)=>c.req.header('authorization')==='Bearer customer'?'Uf':null,resolveFriendId:async(_c:any,u:string)=>u==='Uf'?'f':null}));
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T04:00:00Z'));});
afterEach(()=>{d.raw.close();vi.useRealTimers();});
async function setup(){
 const app=gapApp(d,[memberRanks]);
 for(const [p,b]of [['program',{metric:'visits',windowMonths:6,expectedVersion:0}],['tiers',{expectedVersion:1,tiers:[{id:'base',name:'一般',threshold:0,mileMultiplier:1,benefitDescriptions:['会員の特典']},{id:'gold',name:'金',threshold:4,mileMultiplier:2,benefitDescriptions:['マイル2倍']}]}]]as const){const r=await gapCall(app,'/api/member-ranks/'+p+'?account_id=a','PUT',b);expect(r.status,await r.clone().text()).toBe(200);}
 for(let n=0;n<2;n++){seedGapBooking(d,'v'+n,'confirmed','2026-10-15T04:00:00Z');d.raw.prepare("INSERT INTO booking_visit_marks(id,booking_id,line_account_id,kind,marked_by_staff_id,marked_at) VALUES(?,?,'a','visited','o','2026-10-15T04:00:00Z')").run('mark'+n,'v'+n);}
 const r=await gapCall(app,'/api/member-ranks/activate?account_id=a','POST',{expectedVersion:2});expect(r.status).toBe(200);
 return app;
}
test('RANK-15: 本人の会員番号・短い特典・next.progress。再読込でも同番号',async()=>{
 const app=await setup();const read=()=>app.request('/api/liff/member-card?liffId=liff-a&friendId=f2',{headers:{Authorization:'Bearer customer'}});
 const r=await read();expect(r.status).toBe(200);const card=(await r.json() as any).data;
 expect(card).toMatchObject({memberNumber:expect.stringMatching(/^[A-F0-9]{16}$/),name:'一般',benefits:['会員の特典'],next:{name:'金',remaining:2,progress:0.5}});
 expect(card.memberNumber).not.toBe('f');expect(card.memberNumber).not.toBe((d.raw.prepare("SELECT member_number FROM friends WHERE id='f2'").get() as any).member_number);expect((await (await read()).json() as any).data.memberNumber).toBe(card.memberNumber);
 expect((await app.request('/api/liff/member-card?liffId=liff-a')).status).toBe(401);
 expect((await app.request('/api/liff/member-card?liffId=other',{headers:{Authorization:'Bearer customer'}})).status).toBe(401);
});
test('RFM-11: 既存の検索形式で4条件をANDし、配信の同じ控えと一致する',async()=>{
 await setup();await refreshCustomerSegments(d.db,'a',new Date());
 d.raw.exec("UPDATE customer_activity_daily SET amount=5000 WHERE friend_id='f' AND basis='purchase'");
 const rules=[{type:'visit_count',value:{min:2,max:3}},{type:'purchase_amount',value:{min:5000}},{type:'last_activity_at',value:{from:'2026-10-15',to:'2026-10-15'}},{type:'member_tier',value:'base'}] as const;
 const conditions={all:rules.map(r=>({kind:r.type,op:r.type==='member_tier'?'eq':'between',value:r.value}))};
 const app=gapApp(d,[friends]);const r=await gapCall(app,'/api/friends?lineAccountId=a&conditions='+encodeURIComponent(JSON.stringify(conditions)));expect(r.status,await r.clone().text()).toBe(200);const result=await r.json() as any;expect(result.data.items.map((f:any)=>f.id)).toEqual(['f']);
 const q=buildSegmentQuery({operator:'AND',rules:[...rules]});expect(d.raw.prepare(q.sql).all(...q.bindings).map((f:any)=>f.id)).toEqual(['f']);
 const bad={all:[{kind:'visit_count',op:'between',value:{min:4,max:2}}]};expect((await gapCall(app,'/api/friends?lineAccountId=a&conditions='+encodeURIComponent(JSON.stringify(bad)))).status).toBe(422);
 expect((await gapCall(app,'/api/friends?lineAccountId=b&conditions='+encodeURIComponent(JSON.stringify(conditions)))).status).toBe(404);
});

test.each([
 ['visit_count',{min:3},{min:2,max:2}],
 ['purchase_amount',{min:6000},{min:5000,max:5000}],
 ['last_activity_at',{from:'2026-10-16'},{from:'2026-10-15',to:'2026-10-15'}],
 ['member_tier','gold','base'],
] as const)('%s: 1条件だけでも一致と不一致を分け、anyでも同じ値を使う',async(kind,miss,hit)=>{
 await setup();await refreshCustomerSegments(d.db,'a',new Date());
 d.raw.exec("UPDATE customer_activity_daily SET amount=5000 WHERE friend_id='f' AND basis='purchase'");
 const app=gapApp(d,[friends]);
 for(const mode of ['all','any']as const)for(const [value,expected]of [[miss,[]],[hit,['f']]]as const){
  const conditions={[mode]:[{kind,op:kind==='member_tier'?'eq':'between',value}]};
  const r=await gapCall(app,'/api/friends?lineAccountId=a&conditions='+encodeURIComponent(JSON.stringify(conditions)));
  expect(r.status,await r.clone().text()).toBe(200);
  const ids=(await r.json() as any).data.items.map((x:any)=>x.id);
  if(kind==='member_tier'&&value==='base')expect(ids.sort()).toEqual(['f','f2']);else expect(ids).toEqual(expected);
 }
});
