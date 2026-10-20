import {GapError} from '../../services/gap-common.js';
export async function simulateAttribution(db:D1Database,a:string,b:Record<string,unknown>,now=new Date()){
 if(b.testMode!==true)throw new GapError('test_mode_required');
 if(!['click','purchase'].includes(String(b.kind))||typeof b.eventId!=='string'||!/^[-\w:]{1,128}$/.test(b.eventId)||typeof b.sendId!=='string'||typeof b.friendId!=='string'||typeof b.occurredAt!=='string'||!Number.isFinite(Date.parse(b.occurredAt))||Date.parse(b.occurredAt)>now.getTime())throw new GapError('invalid_attribution');
 if(b.kind==='purchase'&&(typeof b.orderId!=='string'||!b.orderId||b.orderId.length>128||!Number.isSafeInteger(b.amount)||Number(b.amount)<0))throw new GapError('invalid_order');
 const request=JSON.stringify({sendId:b.sendId,friendId:b.friendId,kind:b.kind,occurredAt:b.occurredAt,orderId:b.kind==='purchase'?b.orderId:null,amount:b.kind==='purchase'?b.amount:null});
 const old=await db.prepare('SELECT request_json FROM ec_auto_line_attribution_events WHERE account_id=? AND external_event_id=?').bind(a,b.eventId).first<{request_json:string}>();
 if(old){if(old.request_json!==request)throw new GapError('idempotency_conflict',409);return {accepted:true,replayed:true,testMode:true};}
 const send=await db.prepare("SELECT id,sent_at FROM ec_auto_line_sends WHERE id=? AND account_id=? AND friend_id=? AND test_mode=1 AND status='simulated'").bind(b.sendId,a,b.friendId).first<{id:string;sent_at:string}>();if(!send)throw new GapError('send_not_found',404);
 const occurred=Date.parse(b.occurredAt);if(occurred<Date.parse(send.sent_at)||occurred>Date.parse(send.sent_at)+7*86400000)throw new GapError('attribution_window_closed',409);
 // Only a link click on this recipient's simulated message can attribute an order.
 const insert=await db.prepare(`INSERT INTO ec_auto_line_attribution_events(id,account_id,send_id,friend_id,kind,external_event_id,order_id,amount,occurred_at,request_json)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE ?='click' OR EXISTS(SELECT 1 FROM ec_auto_line_attribution_events x WHERE x.send_id=? AND x.account_id=? AND x.friend_id=? AND x.kind='click' AND julianday(x.occurred_at)<=julianday(?) AND x.test_mode=1) ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),a,send.id,b.friendId,b.kind,b.eventId,b.kind==='purchase'?b.orderId:null,b.kind==='purchase'?b.amount:null,b.occurredAt,request,b.kind,send.id,a,b.friendId,b.occurredAt).run();
 if(!insert.meta.changes){const saved=await db.prepare('SELECT request_json FROM ec_auto_line_attribution_events WHERE account_id=? AND external_event_id=?').bind(a,b.eventId).first<{request_json:string}>();if(saved?.request_json===request)return {accepted:true,replayed:true,testMode:true};throw new GapError('link_required_or_duplicate_order',409);}
 return {accepted:true,replayed:false,testMode:true};
}
export async function simulationResults(db:D1Database,a:string,send?:string){
 const row=await db.prepare(`SELECT COUNT(DISTINCT CASE WHEN kind='click' THEN send_id END) clickedMessages,COUNT(DISTINCT CASE WHEN kind='purchase' THEN order_id END) purchases,COALESCE(SUM(CASE WHEN kind='purchase' THEN amount ELSE 0 END),0) purchaseAmount FROM ec_auto_line_attribution_events WHERE account_id=? AND test_mode=1 AND (? IS NULL OR send_id=?)`).bind(a,send??null,send??null).first();
 return row;
}
