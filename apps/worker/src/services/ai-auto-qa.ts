import { jstCalendar as japanCalendar } from '@line-crm/shared';
import {maskAiText} from './ai-drafts.js';
import {GapError} from './gap-common.js';

export interface QaMatch {id:string;title:string;version:number;messages:unknown[];confidence:number}
export interface QaDecision {action:'answered'|'handed_off'|'customer_asked_human';handoffReason:string|null;qa:QaMatch|null}
export const simulatedQaPrefix='ai-sim:';

export async function simulateIncomingQa(db:D1Database,input:{account:string;friendId:string;eventId:string;question:string;kind:string}){
 const mode=await db.prepare('SELECT mode FROM ai_settings WHERE account_id=?').bind(input.account).first<{mode:string}>();
 if(mode?.mode!=='auto_qa'&&mode?.mode!=='suspended')return;
 const chat=await db.prepare('SELECT id FROM chats WHERE friend_id=?').bind(input.friendId).first<{id:string}>();
 if(chat)await simulateQa(db,{...input,chatId:chat.id});
}

/** Conservative local matching: unknown paraphrases go to a person; no generated answer. */
export async function evaluateQa(db:D1Database,account:string,question:string,kind='text'):Promise<QaDecision>{
 const handoff=(reason:string):QaDecision=>({action:'handed_off',handoffReason:reason,qa:null});
 if(/人と話|人に代|担当者.*(話|代)|オペレーター|human|agent/i.test(question))return {action:'customer_asked_human',handoffReason:'customer_requested',qa:null};
 if(kind!=='text')return handoff('media');
 if(maskAiText(question)!==question||/個人情報|住所|電話|カード|健康|病気|アレルギー|password|パスワード/i.test(question))return handoff('pii');
 if(/返金|料金|支払|決済|請求|値引|お金|refund|payment|charge|price/i.test(question))return handoff('money');
 if(/(予約|booking|reservation).*(変更|取消|キャンセル|変え|やめ|change|cancel)|(変更|取消|キャンセル).*(予約|booking)/i.test(question))return handoff('booking_change');
 if(/苦情|怒|最悪|ひどい|酷い|ふざけ|詐欺|許せ|クレーム|不満|失礼|納得|対応が悪|二度と|責任|謝罪|訴え|ばか|バカ|馬鹿|むかつ|ムカつ|ありえない|あり得ない|complaint|terrible|angry|unacceptable/i.test(question))return handoff('complaint');
 const rows=(await db.prepare("SELECT id,questions_json,answer_messages_json,version FROM qa_entries WHERE account_id=? AND status='published' AND EXISTS(SELECT 1 FROM json_each(questions_json) WHERE trim(value)=?) ORDER BY id LIMIT 2").bind(account,question.trim()).all<{id:string;questions_json:string;answer_messages_json:string;version:number}>()).results;
 if(rows.length!==1)return handoff('low_confidence');
 const q=rows[0],messages:unknown=JSON.parse(q.answer_messages_json);
 // Only validated text snapshots are currently eligible. Other formats need their delivery adapter.
 if(!Array.isArray(messages)||!messages.length||messages.length>5||messages.some(m=>!m||typeof m!=='object'||(m as {type?:unknown}).type!=='text'||typeof (m as {text?:unknown}).text!=='string'||!(m as {text:string}).text.trim()))return handoff('low_confidence');
 return {action:'answered',handoffReason:null,qa:{id:q.id,title:JSON.parse(q.questions_json)[0],version:q.version,messages,confidence:1}};
}

/** No sender or provider is accepted here. Every persisted row is explicitly a simulation. */
export async function simulateQa(db:D1Database,input:{account:string;chatId:string;eventId:string;question:string;kind?:string;keywordMatched?:boolean;now?:Date}){
 const now=input.now??new Date(),at=now.toISOString();
 const chat=await db.prepare('SELECT c.friend_id,f.display_name FROM chats c JOIN friends f ON f.id=c.friend_id WHERE c.id=? AND f.line_account_id=?').bind(input.chatId,input.account).first<{friend_id:string;display_name:string}>();
 if(!chat)throw new GapError('not_found',404);
 if(input.keywordMatched)return {sent:false,testMode:true,skipped:'keyword_matched'};
 const settings=await db.prepare('SELECT * FROM ai_settings WHERE account_id=?').bind(input.account).first<{mode:string;monthly_limit_answers:number;confidence_threshold:number;handoff_message:string|null;handoff_message_enabled:number}>();
 if(!settings||!['auto_qa','suspended'].includes(settings.mode))return {sent:false,testMode:true,skipped:'disabled'};
 const fingerprint=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
 const id=simulatedQaPrefix+await fingerprint(JSON.stringify([input.account,input.eventId]));
 // Keep only a salted fingerprint, never the unmasked question, for conflict detection.
 const signature=await fingerprint(JSON.stringify([input.account,input.eventId,input.chatId,input.question,input.kind??'text']));
 const existing=await db.prepare('SELECT * FROM ai_answer_logs WHERE id=? AND account_id=?').bind(id,input.account).first<Record<string,unknown>>();
 const replay=(r:Record<string,unknown>,replayed:boolean)=>{
  const note=JSON.parse(String(r.after_note));if(note.signature!==signature)throw new GapError('idempotency_conflict',409);
  return {id,action:r.action,handoffReason:r.handoff_reason,qaEntryId:r.qa_entry_id,messages:JSON.parse(String(r.answer_snapshot_json??'[]')),handoffMessage:r.action==='answered'?null:note.handoffMessage??null,sent:false as const,testMode:true as const,replayed};
 };
 if(existing)return replay(existing,true);
 let decision=await evaluateQa(db,input.account,input.question,input.kind),reason=decision.handoffReason;
 if(decision.action!=='customer_asked_human'){
  const human=await db.prepare("SELECT 1 FROM ai_answer_logs WHERE account_id=? AND friend_id=? AND action='customer_asked_human' AND julianday(created_at)>julianday(?,'-24 hours') LIMIT 1").bind(input.account,chat.friend_id,at).first();
  const typing=await db.prepare("SELECT 1 FROM inbox_reply_leases WHERE channel='line' AND conversation_id=? AND julianday(expires_at)>julianday(?)").bind(input.chatId,at).first();
  if(human)reason='customer_requested';else if(settings.mode==='suspended')reason='suspended';else if(typing)reason='typing';
  if(reason)decision={action:'handed_off',handoffReason:reason,qa:null};
 }
 const monthStart=new Date(`${japanCalendar(now).toISOString().slice(0,7)}-01T00:00:00+09:00`).toISOString();
 // The event row, monthly cap and per-person cap share one transaction. No check-then-insert race.
 const countSql="SELECT count(*) FROM ai_answer_logs WHERE account_id=? AND action='answered' AND id LIKE 'ai-sim:%' AND julianday(created_at)>=julianday(?)";
 const guard=decision.action==='answered'?` AND (${countSql})<(SELECT monthly_limit_answers FROM ai_settings WHERE account_id=?) AND (SELECT count(*) FROM ai_answer_logs WHERE account_id=? AND friend_id=? AND action='answered' AND id LIKE 'ai-sim:%' AND julianday(created_at)>julianday(?,'-30 minutes'))<3 AND EXISTS(SELECT 1 FROM qa_entries WHERE id=? AND account_id=? AND status='published' AND version=?) AND EXISTS(SELECT 1 FROM ai_settings WHERE account_id=? AND mode='auto_qa' AND confidence_threshold<=1) AND NOT EXISTS(SELECT 1 FROM ai_answer_logs WHERE account_id=? AND friend_id=? AND action='customer_asked_human' AND julianday(created_at)>julianday(?,'-24 hours')) AND NOT EXISTS(SELECT 1 FROM inbox_reply_leases WHERE channel='line' AND conversation_id=? AND julianday(expires_at)>julianday(?))`:'';
 const priorHandoff=await db.prepare("SELECT 1 FROM ai_answer_logs WHERE account_id=? AND chat_id=? AND action!='answered' AND id LIKE 'ai-sim:%' AND julianday(created_at)>julianday(?,'-24 hours') LIMIT 1").bind(input.account,input.chatId,at).first();
 const note={signature,testMode:true,handoffMessage:reason!=='typing'&&!priorHandoff&&settings.handoff_message_enabled?(settings.handoff_message??'担当者からご返信します'):null};
 const insert=(action:string,why:string|null,messages:unknown[],extraGuard:string,extra:unknown[])=>db.prepare(`INSERT INTO ai_answer_logs(id,account_id,chat_id,friend_id,question_text,action,handoff_reason,qa_entry_id,qa_version,answer_snapshot_json,after_note,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ai_answer_logs WHERE id=?)${extraGuard}`).bind(id,input.account,input.chatId,chat.friend_id,maskAiText(input.question,[chat.display_name]),action,why,action==='answered'?decision.qa?.id??null:null,action==='answered'?decision.qa?.version??null:null,JSON.stringify(messages),JSON.stringify(note),at,id,...extra);
 const extra=decision.action==='answered'?[input.account,monthStart,input.account,input.account,chat.friend_id,at,decision.qa!.id,input.account,decision.qa!.version,input.account,input.account,chat.friend_id,at,input.chatId,at]:[];
 const savedBatch=await db.batch([
  insert(decision.action,decision.handoffReason,decision.qa?.messages??[],guard,extra),
  // A concurrent event can exhaust the allowance or stop the QA. Record a handoff, never an answer.
  insert('handed_off','rate_or_qa_changed',[],'',[]),
  db.prepare(`UPDATE ai_answer_logs SET handoff_reason=CASE
   WHEN NOT EXISTS(SELECT 1 FROM ai_settings WHERE account_id=? AND mode='auto_qa') THEN 'suspended'
   WHEN EXISTS(SELECT 1 FROM ai_answer_logs WHERE account_id=? AND friend_id=? AND action='customer_asked_human' AND julianday(created_at)>julianday(?,'-24 hours')) THEN 'customer_requested'
   WHEN EXISTS(SELECT 1 FROM inbox_reply_leases WHERE channel='line' AND conversation_id=? AND julianday(expires_at)>julianday(?)) THEN 'typing'
   WHEN (${countSql})>=(SELECT monthly_limit_answers FROM ai_settings WHERE account_id=?) THEN 'monthly_limit'
   WHEN (SELECT count(*) FROM ai_answer_logs WHERE account_id=? AND friend_id=? AND action='answered' AND id LIKE 'ai-sim:%' AND julianday(created_at)>julianday(?,'-30 minutes'))>=3 THEN 'rate'
   ELSE 'qa_changed' END WHERE id=? AND handoff_reason='rate_or_qa_changed'`).bind(input.account,input.account,chat.friend_id,at,input.chatId,at,input.account,monthStart,input.account,input.account,chat.friend_id,at,id),
  db.prepare(`UPDATE ai_answer_logs SET after_note=json_set(after_note,'$.customerAskedHumanAt',?) WHERE account_id=? AND chat_id=? AND action='answered' AND id LIKE 'ai-sim:%' AND EXISTS(SELECT 1 FROM ai_answer_logs WHERE id=? AND action='customer_asked_human')`).bind(at,input.account,input.chatId,id),
 ]);
 const saved=await db.prepare('SELECT * FROM ai_answer_logs WHERE id=?').bind(id).first<Record<string,unknown>>();
 if(!saved)throw new GapError('simulation_unavailable',503);
 return replay(saved,!savedBatch[0].meta.changes&&!savedBatch[1].meta.changes);
}
