import {Hono} from 'hono';
import type {Env} from '../index.js';
import {GapError,gapAccount,gapBody} from '../services/gap-common.js';
import {requirePermission} from '../middleware/role-guard.js';
export const aiAnswerLogs=new Hono<Env>();
aiAnswerLogs.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'ai_log_unavailable'},e instanceof GapError?e.status:503));
aiAnswerLogs.use('/api/ai-answer-logs*',requirePermission('/auto-replies'));
function view(r:Record<string,unknown>,masked:boolean){return {id:r.id,createdAt:r.created_at,chatId:r.chat_id,friendId:r.friend_id,friendName:masked?null:r.friend_name,questionText:masked?'（非表示）':r.question_text,action:r.action,handoffReason:r.handoff_reason,qaEntryId:r.qa_entry_id,qaTitle:r.qa_title,qaVersion:r.qa_version};}
aiAnswerLogs.get('/api/ai-answer-logs',async c=>{
 const a=await gapAccount(c),offset=Number(c.req.query('offset')??0),action=c.req.query('action')??'';
 if(!Number.isSafeInteger(offset)||offset<0||action&&!['answered','handed_off','customer_asked_human'].includes(action))throw new GapError('invalid_filter');
 const where='l.account_id=? AND (?=\'\' OR l.action=?)',bind=[a,action,action];
 const total=await c.env.DB.prepare(`SELECT count(*) n FROM ai_answer_logs l WHERE ${where}`).bind(...bind).first<{n:number}>();
 const rows=(await c.env.DB.prepare(`SELECT l.*,f.display_name friend_name,json_extract(q.questions_json,'$[0]') qa_title FROM ai_answer_logs l LEFT JOIN friends f ON f.id=l.friend_id AND f.line_account_id=l.account_id LEFT JOIN qa_entries q ON q.id=l.qa_entry_id AND q.account_id=l.account_id WHERE ${where} ORDER BY l.created_at DESC,l.id LIMIT 20 OFFSET ?`).bind(...bind,offset).all<Record<string,unknown>>()).results;
 const summary=await c.env.DB.prepare(`SELECT count(CASE WHEN action='answered' THEN 1 END) answered,count(CASE WHEN action='handed_off' THEN 1 END) handedOff FROM ai_answer_logs WHERE account_id=?`).bind(a).first();
 return c.json({success:true,data:{items:rows.map(r=>view(r,!!c.get('impersonation'))),total:total?.n??0,summary:{...summary,askedAgainRate:null}}});
});
aiAnswerLogs.get('/api/ai-answer-logs/:id',async c=>{
 const a=await gapAccount(c),r=await c.env.DB.prepare('SELECT l.*,f.display_name friend_name FROM ai_answer_logs l LEFT JOIN friends f ON f.id=l.friend_id AND f.line_account_id=l.account_id WHERE l.id=? AND l.account_id=?').bind(c.req.param('id'),a).first<Record<string,unknown>>();if(!r)throw new GapError('not_found',404);
 const q=await c.env.DB.prepare('SELECT * FROM qa_entries WHERE id=? AND account_id=?').bind(r.qa_entry_id,a).first<Record<string,unknown>>();
 const answers=(s:unknown)=>{try{return (JSON.parse(String(s??'[]')) as Array<{text?:string}>).map(x=>x.text??'').join('\n');}catch{return null;}};
 return c.json({success:true,data:{...view(r,!!c.get('impersonation')),answerText:c.get('impersonation')?null:answers(r.answer_snapshot_json),qa:q?{id:q.id,title:JSON.parse(String(q.questions_json))[0],status:q.status,useCount:q.use_count,version:q.version,updatedAt:q.updated_at,currentAnswerText:answers(q.answer_messages_json)}:null,afterNote:c.get('impersonation')?null:r.after_note??null}});
});
aiAnswerLogs.post('/api/ai-settings/test',requirePermission('/auto-replies'),async c=>{
 const a=await gapAccount(c),b=await gapBody(c);if(typeof b.question!=='string'||!b.question.trim()||b.question.length>500)throw new GapError('invalid_question');
 const q=await c.env.DB.prepare("SELECT id,questions_json FROM qa_entries WHERE account_id=? AND status='published' AND EXISTS(SELECT 1 FROM json_each(questions_json) WHERE value=?) LIMIT 1").bind(a,b.question).first<{id:string;questions_json:string}>();
 return c.json({success:true,data:{qaEntryId:q?.id??null,qaTitle:q?JSON.parse(q.questions_json)[0]:null,handoffReason:q?null:'low_confidence',testMode:true}});
});
