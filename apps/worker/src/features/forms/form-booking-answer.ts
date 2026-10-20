import { collectInputs, parseLayout, normalizeBookingValue } from '@line-crm/shared';

export class FormBookingAnswerError extends Error {
  constructor(public readonly status:400|404|422,code:string){super(code);}
}
/** The completed answer and its pinned public version are the only source of booking rules. */
export async function resolveFormBookingAnswer(db:D1Database,input:{formId:string;blockId:string;submissionKey:string},accountId:string,friendId:string,timeZone:string,now=new Date()) {
  if(!input||typeof input!=='object'||![input.formId,input.blockId,input.submissionKey].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new FormBookingAnswerError(400,'invalid_form_answer');
  const saved=await db.prepare(`SELECT s.id,s.data,v.layout,v.fields FROM form_submit_claims q
    JOIN form_submissions s ON s.id=q.submission_id AND s.form_id=q.form_id AND s.friend_id=q.friend_id
    JOIN form_versions v ON v.id=s.form_version_id AND v.form_id=s.form_id
    WHERE q.form_id=? AND q.idempotency_key=? AND q.line_account_id=? AND q.friend_id=? AND q.status='completed' AND s.is_test=0
    AND EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=s.form_id AND fa.line_account_id=?)`)
    .bind(input.formId,input.submissionKey,accountId,friendId,accountId).first<{id:string;data:string;layout:string;fields:string}>();
  if(!saved)throw new FormBookingAnswerError(404,'saved_answer_required');
  const block=collectInputs(parseLayout(saved.layout,saved.fields)).find(b=>b.id===input.blockId&&b.type==='booking');
  const picked=block?normalizeBookingValue(JSON.parse(saved.data)[block.name]):null;
  if(!block||!picked||picked.kind==='seats'||block.booking?.kind==='seats'||!block.booking)throw new FormBookingAnswerError(422,'invalid_booking_answer');
  const config=block.booking;
  if((!config.allowMenuSelection&&picked.menuId!==config.menuId)||(config.staffId&&picked.staffId!==config.staffId))throw new FormBookingAnswerError(422,'invalid_booking_answer');
  const menu=await db.prepare('SELECT id FROM menus WHERE id=? AND line_account_id=? AND is_active=1 AND deleted_at IS NULL').bind(picked.menuId,accountId).first();
  if(!menu)throw new FormBookingAnswerError(422,'menu_not_offered');
  const dateKey=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  const start=new Date(picked.startsAt),today=dateKey(now),selected=dateKey(start);
  const ahead=config.daysAhead??14;
  const days=(Date.parse(selected)-Date.parse(today))/86400000;
  if(!Number.isFinite(start.getTime())||start<=now||days<0||days>ahead)throw new FormBookingAnswerError(422,'outside_form_booking_window');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${saved.id}:${block.id}`));
  return {menuId:picked.menuId,staffId:picked.staffId,startsAt:picked.startsAt,requireApproval:config.requireApproval===true,
    idempotencyKey:'form_'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')};
}
