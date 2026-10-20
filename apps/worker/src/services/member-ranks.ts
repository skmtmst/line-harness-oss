import { jstDate as japanDate } from '@line-crm/shared';
import {assertChanged,clearAssertions} from '../features/booking/booking-series/index.js';
import {GapError} from './gap-common.js';
export type RankTier={id:string;name:string;threshold:number;mileMultiplier:number;tagId?:string;benefitDescriptions?:string[];couponCode?:string|null;upgradeMessages?:Array<{type:"text";text:string}>;downgradeMessages?:Array<{type:"text";text:string}>};
export async function rankProgram(db:D1Database,a:string){
 const p=await db.prepare('SELECT * FROM member_rank_programs WHERE account_id=?').bind(a).first<Record<string,unknown>>();
 const tiers=(await db.prepare('SELECT * FROM member_rank_tiers WHERE account_id=? AND sort>=0 ORDER BY sort').bind(a).all<Record<string,unknown>>()).results.map(t=>({id:String(t.id),name:String(t.name),threshold:Number(t.threshold),mileMultiplier:Number(t.mile_multiplier),tagId:String(t.tag_id),benefitDescriptions:JSON.parse(String(t.benefit_descriptions_json)),couponCode:t.coupon_code==null?null:String(t.coupon_code),upgradeMessages:JSON.parse(String(t.upgrade_message_json)),downgradeMessages:JSON.parse(String(t.downgrade_message_json))}));
 return {metric:String(p?.metric??'visits'),windowMonths:Number(p?.window_months??6),status:String(p?.status??'stopped'),version:Number(p?.version??0),activatedAt:p?.activated_at??null,tiers,notificationsAvailable:false,simulationAvailable:true,testMode:true,notifyUpgrade:p?!!p.notify_upgrade:true,notifyDowngrade:p?!!p.notify_downgrade:true,evaluationToken:p?.evaluation_token??null};
}
export async function rankPreview(db:D1Database,a:string,program?:Awaited<ReturnType<typeof rankProgram>>,now=new Date()){
 const p=program??await rankProgram(db,a);if(p.tiers.length<2)throw new GapError('tiers_required');
 const since=new Date(now);since.setUTCMonth(since.getUTCMonth()-p.windowMonths);
 const sql=p.metric==='visits'?`SELECT b.friend_id,COUNT(*) score FROM bookings b WHERE b.line_account_id=? AND julianday(b.starts_at)>=julianday(?) AND julianday(b.starts_at)<=julianday(?) AND b.status NOT IN('cancelled','rejected','no_show') AND (SELECT kind FROM booking_visit_marks v WHERE v.booking_id=b.id ORDER BY julianday(marked_at) DESC,v.id DESC LIMIT 1)='visited' GROUP BY b.friend_id`:
 p.metric==='amount'?`SELECT friend_id,SUM(MAX(0,total_amount_minor-COALESCE(refunded_amount_minor,0))) score FROM ec_orders WHERE line_account_id=? AND normalized_status='current' AND currency='JPY' AND julianday(ordered_at)>=julianday(?) AND julianday(ordered_at)<=julianday(?) GROUP BY friend_id`:
 `SELECT l.beneficiary_friend_id friend_id,SUM(l.amount) score FROM mileage_ledger l JOIN friends f ON f.id=l.beneficiary_friend_id WHERE f.line_account_id=? AND l.status='available' AND l.entry_type IN('grant','reversal') AND julianday(l.occurred_at)>=julianday(?) AND julianday(l.occurred_at)<=julianday(?) GROUP BY l.beneficiary_friend_id`;
 const scores=(await db.prepare(sql).bind(a,since.toISOString(),now.toISOString()).all<{friend_id:string;score:number}>()).results;
 const scoreMap=new Map(scores.map(s=>[s.friend_id,s.score]));
 const friends=(await db.prepare('SELECT f.id,r.tier_id,r.downgrade_due_at,t.threshold current_threshold FROM friends f LEFT JOIN member_ranks r ON r.friend_id=f.id AND r.account_id=f.line_account_id LEFT JOIN member_rank_tiers t ON t.id=r.tier_id AND t.account_id=r.account_id WHERE f.line_account_id=? ORDER BY f.id').bind(a).all<{id:string;tier_id:string|null;downgrade_due_at:string|null;current_threshold:number|null}>()).results;
 const byTier=p.tiers.map(t=>({tierId:t.id,name:t.name,count:0}));let wouldUpgrade=0,wouldDowngrade=0;
 const decisions=friends.map(f=>{const score=Math.max(0,scoreMap.get(f.id)??0),tier=[...p.tiers].reverse().find(t=>t.threshold<=score)??p.tiers[0];byTier.find(t=>t.tierId===tier.id)!.count++;const before=f.current_threshold;if(before!==null&&tier.threshold>before)wouldUpgrade++;if(before!==null&&tier.threshold<before)wouldDowngrade++;return {...f,score,tier};});
 return {byTier,wouldUpgrade,wouldDowngrade,decisions};
}
export async function rankEvaluationStatements(db:D1Database,a:string,p:Awaited<ReturnType<typeof rankProgram>>,initial:boolean,now=new Date()){
 const preview=await rankPreview(db,a,p,now),at=now.toISOString(),ops:D1PreparedStatement[]=[];
 if(initial)ops.push(db.prepare("UPDATE member_rank_notices SET status='cancelled' WHERE account_id=? AND status='scheduled'").bind(a));
 for(const d of preview.decisions){
 const downgrade=d.current_threshold!==null&&d.tier.threshold<d.current_threshold;
 if(downgrade&&(!d.downgrade_due_at||Date.parse(d.downgrade_due_at)>now.getTime())){
 const due=new Date(now.getTime()+14*86400000).toISOString();
 ops.push(db.prepare('UPDATE member_ranks SET downgrade_due_at=COALESCE(downgrade_due_at,?) WHERE account_id=? AND friend_id=?').bind(due,a,d.id));
 if(!initial&&!d.downgrade_due_at&&p.notifyDowngrade){const current=p.tiers.find(t=>t.id===d.tier_id);if(current)ops.push(rankNotice(db,a,d.id,current,'downgrade_warning',due,now));}continue;
 }
 if(d.tier_id===d.tier.id){ops.push(db.prepare("UPDATE member_rank_notices SET status='cancelled' WHERE account_id=? AND friend_id=? AND kind='downgrade_warning' AND status IN('scheduled','simulated')").bind(a,d.id),db.prepare('UPDATE member_ranks SET downgrade_due_at=NULL WHERE account_id=? AND friend_id=?').bind(a,d.id));continue;}
 if(!initial&&d.tier_id&&!downgrade&&p.notifyUpgrade)ops.push(rankNotice(db,a,d.id,d.tier,'upgrade',at+':'+d.tier.id,now));
 ops.push(db.prepare("UPDATE member_rank_notices SET status='cancelled' WHERE account_id=? AND friend_id=? AND status='scheduled' AND kind='downgrade_warning'").bind(a,d.id),db.prepare('INSERT INTO member_ranks(account_id,friend_id,tier_id,since) VALUES(?,?,?,?) ON CONFLICT(account_id,friend_id) DO UPDATE SET tier_id=excluded.tier_id,since=excluded.since,downgrade_due_at=NULL').bind(a,d.id,d.tier.id,at),
 db.prepare('INSERT INTO member_rank_history(id,account_id,friend_id,from_tier_id,to_tier_id,reason,at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),a,d.id,d.tier_id,d.tier.id,!d.tier_id?'initial':initial?'program_change':downgrade?'downgrade':'upgrade',at),
 db.prepare('DELETE FROM friend_tags WHERE friend_id=? AND tag_id IN(SELECT tag_id FROM member_rank_tiers WHERE account_id=?)').bind(d.id,a),
 db.prepare('INSERT OR IGNORE INTO friend_tags(friend_id,tag_id) VALUES(?,?)').bind(d.id,d.tier.tagId));
 }
 // Notice ledger remains simulation-only and is committed with the rank decision.
 return ops;
}
export async function evaluateRanks(db:D1Database,a:string,initial:boolean,now=new Date()){
 const p=await rankProgram(db,a);if(p.status!=='active')return;
 const ops=await rankEvaluationStatements(db,a,p,initial,now);
 if(ops.length){try{await db.batch([db.prepare("UPDATE member_rank_programs SET evaluation_token=?,initial_version=version WHERE account_id=? AND version=? AND status='active' AND evaluation_token IS ?").bind(crypto.randomUUID(),a,p.version,p.evaluationToken),assertChanged(db),...ops,clearAssertions(db)]);}catch(e){if(/CHECK constraint/.test(String(e)))throw new GapError('version_conflict',409);throw e;}}
}

function rankNotice(db:D1Database,a:string,f:string,t:RankTier,kind:'upgrade'|'downgrade_warning',key:string,now:Date){
 const base=kind==='upgrade'?(t.upgradeMessages?.length?t.upgradeMessages:[{type:'text',text:`会員ランクが${t.name}になりました`}]) : (t.downgradeMessages?.length?t.downgradeMessages:[{type:'text',text:`${t.name}の条件まで、14日間の猶予があります`}]);
 const messages=t.couponCode?[...base,{type:'text',text:`特典クーポン：${t.couponCode}`}]:base;
 const day=japanDate(now);
 const scheduled=new Date(`${day}T10:00:00+09:00`);
 return db.prepare('INSERT OR IGNORE INTO member_rank_notices(id,account_id,friend_id,change_key,kind,tier_id,purpose,messages_json,base_messages_json,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),a,f,key,kind,t.id,t.couponCode?'marketing':'notice',JSON.stringify(messages),JSON.stringify(base),scheduled.toISOString());
}
export async function processRankNotices(db:D1Database,now=new Date(),account?:string){
 const rows=(await db.prepare("SELECT id FROM member_rank_notices WHERE status='scheduled' AND julianday(scheduled_at)<=julianday(?) AND (? IS NULL OR account_id=?) ORDER BY scheduled_at,id LIMIT 100").bind(now.toISOString(),account??null,account??null).all<{id:string}>()).results;
 let processed=0;
 for(const r of rows){
 const result=await db.prepare(`UPDATE member_rank_notices AS n SET
 status=CASE WHEN NOT EXISTS(SELECT 1 FROM member_rank_programs p WHERE p.account_id=n.account_id AND p.status='active' AND CASE WHEN n.kind='upgrade' THEN p.notify_upgrade ELSE p.notify_downgrade END=1) THEN 'skipped_disabled'
 WHEN julianday(?)>julianday(scheduled_at,'+3 hours') THEN 'skipped_late'
 WHEN NOT EXISTS(SELECT 1 FROM friends f WHERE f.id=n.friend_id AND f.line_account_id=n.account_id AND f.is_following=1) THEN 'skipped_blocked'
 WHEN EXISTS(SELECT 1 FROM friend_delivery_consents c WHERE c.friend_id=n.friend_id AND c.line_account_id=n.account_id AND c.purpose IN('notice','notification') AND c.state='revoked') THEN 'skipped_opted_out'
 WHEN n.kind='downgrade_warning' AND NOT EXISTS(SELECT 1 FROM member_ranks r WHERE r.account_id=n.account_id AND r.friend_id=n.friend_id AND r.downgrade_due_at=n.change_key) THEN 'cancelled'
 ELSE 'simulated' END,
 messages_json=CASE WHEN EXISTS(SELECT 1 FROM friend_delivery_consents c WHERE c.friend_id=n.friend_id AND c.line_account_id=n.account_id AND c.purpose IN('marketing','promotion','advertising','宣伝') AND c.state='revoked') THEN base_messages_json ELSE messages_json END,
 purpose=CASE WHEN EXISTS(SELECT 1 FROM friend_delivery_consents c WHERE c.friend_id=n.friend_id AND c.line_account_id=n.account_id AND c.purpose IN('marketing','promotion','advertising','宣伝') AND c.state='revoked') THEN 'notice' ELSE purpose END,
 processed_at=? WHERE id=? AND status='scheduled'`).bind(now.toISOString(),now.toISOString(),r.id).run();processed+=result.meta.changes;
 }
 return {processed,sent:false,testMode:true};
}
