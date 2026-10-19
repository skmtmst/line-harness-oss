import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner,seedGapBooking} from '../test-utils/gap1.js';
import {memberRanks} from './member-ranks.js';
import {friends} from './friends.js';
import {evaluateRanks,processRankNotices} from '../services/member-ranks.js';
let d:ReturnType<typeof gapFixture>;
const at=new Date('2026-10-16T19:00:00Z'); // 17th, 04:00 JST
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
async function ok(path:string,b:unknown,method='PUT',key?:string){const r=await gapCall(gapApp(d,[memberRanks]),path+'?account_id=a',method,b,key);expect(r.status,await r.clone().text()).toBe(200);return (await r.json() as any).data;}
const tiers=[{id:'base',name:'一般',threshold:0,mileMultiplier:1},{id:'gold',name:'金',threshold:1,mileMultiplier:2,couponCode:'GOLD10',upgradeMessages:[{type:'text',text:'上がりました'}]}];
async function start(){await ok('/api/member-ranks/program',{metric:'visits',windowMonths:6,expectedVersion:0});await ok('/api/member-ranks/tiers',{tiers,expectedVersion:1});await ok('/api/member-ranks/activate',{expectedVersion:2},'POST','activate');}
function visit(id='v',when='2026-10-17T00:00:00Z'){seedGapBooking(d,id,'confirmed',when);d.raw.prepare("INSERT INTO booking_visit_marks(id,booking_id,line_account_id,kind,marked_by_staff_id,marked_at) VALUES(?,?,'a','visited','o',?)").run('mark-'+id,id,when);}
test('RANK-01/02/05/06/12/16: 初回0、昇格を1回予定し10時に模擬、クーポンは宣伝停止で除去',async()=>{
 await start();expect(d.raw.prepare('SELECT count(*) n FROM member_rank_notices').get()).toEqual({n:0});visit('v','2026-10-16T18:00:00Z');await evaluateRanks(d.db,'a',false,at);await evaluateRanks(d.db,'a',false,at);
 const row=d.raw.prepare('SELECT purpose,scheduled_at,status FROM member_rank_notices').get();expect(row).toEqual({purpose:'marketing',scheduled_at:'2026-10-17T01:00:00.000Z',status:'scheduled'});
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人','liff')");
 await processRankNotices(d.db,new Date('2026-10-17T00:59:00Z'));expect(d.raw.prepare('SELECT status FROM member_rank_notices').get()).toEqual({status:'scheduled'});
 await processRankNotices(d.db,new Date('2026-10-17T01:00:00Z'));await processRankNotices(d.db,new Date('2026-10-17T01:00:00Z'));
 const saved=d.raw.prepare('SELECT purpose,status,messages_json FROM member_rank_notices').get() as any;expect(saved).toMatchObject({purpose:'notice',status:'simulated'});expect(JSON.parse(saved.messages_json)).toEqual([{type:'text',text:'上がりました'}]);expect(d.raw.prepare('SELECT SUM(notified) n FROM member_rank_history').get()).toEqual({n:0});
});
test('RANK-03/04/19: 下がる予告は一度、回復で取消、遅れ・お知らせ停止・ルール停止で模擬しない',async()=>{
 visit('v','2026-10-15T18:00:00Z');await start();await evaluateRanks(d.db,'a',false,new Date('2027-06-01T19:00:00Z'));await evaluateRanks(d.db,'a',false,new Date('2027-06-02T19:00:00Z'));
 expect(d.raw.prepare('SELECT count(*) n FROM member_rank_notices').get()).toEqual({n:1});visit('return','2027-06-03T18:00:00Z');await evaluateRanks(d.db,'a',false,new Date('2027-06-03T19:00:00Z'));expect(d.raw.prepare('SELECT status FROM member_rank_notices').get()).toEqual({status:'cancelled'});
 d.raw.exec("UPDATE member_rank_notices SET kind='upgrade',status='scheduled',scheduled_at='2027-06-04T01:00:00Z'");await processRankNotices(d.db,new Date('2027-06-04T04:01:00Z'));expect(d.raw.prepare('SELECT status FROM member_rank_notices').get()).toEqual({status:'skipped_late'});
 d.raw.exec("UPDATE member_rank_notices SET status='scheduled';INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','notice','revoked','本人','liff')");await processRankNotices(d.db,new Date('2027-06-04T01:00:00Z'));expect(d.raw.prepare('SELECT status FROM member_rank_notices').get()).toEqual({status:'skipped_opted_out'});
});
test('RANK-07/08/17: 設定保存は版・役割を確認し、ランクタグを手で付け外ししない',async()=>{
 await start();const tag=(d.raw.prepare("SELECT tag_id FROM member_rank_tiers WHERE id='base'").get() as any).tag_id;
 expect(d.raw.prepare('SELECT manual_assignment_allowed FROM tags WHERE id=?').get(tag)).toEqual({manual_assignment_allowed:0});
 expect((await gapCall(gapApp(d,[friends]),`/api/friends/f/tags/${tag}`,'DELETE')).status).toBe(403);
 for(const staff of [{...gapOwner,readOnly:true},{...gapOwner,role:'staff' as const}])expect((await gapCall(gapApp(d,[memberRanks],staff),'/api/member-ranks/program?account_id=a','PUT',{metric:'visits',windowMonths:6,expectedVersion:3,notifyUpgrade:false})).status).toBe(403);
 expect((await gapCall(gapApp(d,[memberRanks],gapOwner,true),'/api/member-ranks/tiers?account_id=a','PUT',{tiers,expectedVersion:3})).status).toBe(403);
 const saved=await ok('/api/member-ranks/program',{metric:'visits',windowMonths:6,expectedVersion:3,notifyUpgrade:false,notifyDowngrade:false});expect(saved).toMatchObject({notifyUpgrade:false,notifyDowngrade:false,status:'stopped'});
});
test('RANK-19: 通知予定の保存失敗ならランク・タグ・履歴も戻す',async()=>{
 await start();visit('v','2026-10-16T18:00:00Z');d.raw.exec("CREATE TRIGGER notice_failure BEFORE INSERT ON member_rank_notices BEGIN SELECT RAISE(ABORT,'notice failure');END");
 await expect(evaluateRanks(d.db,'a',false,at)).rejects.toThrow('notice failure');expect(d.raw.prepare("SELECT tier_id FROM member_ranks WHERE friend_id='f'").get()).toEqual({tier_id:'base'});expect(d.raw.prepare("SELECT count(*) n FROM member_rank_history WHERE reason='upgrade'").get()).toEqual({n:0});
});

test('RANK-07: マイル倍率は同じ出来事に一度だけ、別店の同一人物へ持ち出さない',async()=>{
 const {createMileageRule,applyMileageRulesForEvent,processPendingMileageEvents}=await import('@line-crm/db/src/mileage.js');
 visit('v','2026-10-15T18:00:00Z');await start();
 d.raw.exec("INSERT INTO users(id,display_name) VALUES('person','同じ人');UPDATE friends SET user_id='person' WHERE id='f';INSERT INTO friends(id,line_user_id,line_account_id,user_id) VALUES('other-friend','Uother','b','person')");
 const rule=await createMileageRule(d.db,{name:'来店',eventType:'rank-test',amount:10,lineAccountId:'a'});
 const event={friendId:'f',eventType:'rank-test',source:'test',sourceEventId:'one',occurredAt:new Date(Date.now()+1000).toISOString()};
 await applyMileageRulesForEvent(d.db,event);await processPendingMileageEvents(d.db,{now:new Date(Date.now()+2000).toISOString()});await applyMileageRulesForEvent(d.db,event);await processPendingMileageEvents(d.db,{now:new Date(Date.now()+2000).toISOString()});
 const rows=d.raw.prepare('SELECT amount,metadata FROM mileage_ledger WHERE mileage_rule_id=?').all(rule.id) as any[];expect(rows).toHaveLength(1);expect(rows[0].amount).toBe(20);expect(JSON.parse(rows[0].metadata)).toMatchObject({baseAmount:10,multiplierBps:20000});
 const other=await createMileageRule(d.db,{name:'他店',eventType:'other-test',amount:10,lineAccountId:'b'});await applyMileageRulesForEvent(d.db,{...event,friendId:'other-friend',eventType:'other-test',sourceEventId:'other'});await processPendingMileageEvents(d.db,{now:new Date(Date.now()+2000).toISOString()});expect(d.raw.prepare('SELECT amount FROM mileage_ledger WHERE mileage_rule_id=?').get(other.id)).toEqual({amount:10});
});

test('RANK-07: 一括操作でもランクタグを手で付け外しできない',async()=>{
 await start();const {previewFriendBulkRun}=await import('../features/friends/friend-bulk-runs.js');const tag=(d.raw.prepare("SELECT tag_id FROM member_rank_tiers WHERE id='base'").get() as any).tag_id;
 for(const kind of ['add_tag','remove_tag'] as const)await expect(previewFriendBulkRun(d.db,gapOwner,{kind:'explicit',friendIds:['f']},{kind,tagId:tag})).rejects.toMatchObject({code:'rank_tag_managed'});
});

test('RANK-19/Q-12: 遅れた判定も同じ日の10時を基準にし、翌日へ古い知らせを送らない',async()=>{
 await start();visit('late','2026-10-16T18:00:00Z');const late=new Date('2026-10-17T05:00:00Z');await evaluateRanks(d.db,'a',false,late);
 expect(d.raw.prepare('SELECT scheduled_at FROM member_rank_notices').get()).toEqual({scheduled_at:'2026-10-17T01:00:00.000Z'});await processRankNotices(d.db,late);expect(d.raw.prepare('SELECT status FROM member_rank_notices').get()).toEqual({status:'skipped_late'});
});
