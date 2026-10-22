import { listQueryNumber } from '../lib/list-paging.js';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {GapError,gapAccount,gapBody,gapKey,gapWrite} from '../services/gap-common.js';
import {evaluateQa,simulateQa,simulatedQaPrefix} from '../services/ai-auto-qa.js';
import {requirePermission} from '../middleware/role-guard.js';
export const aiAnswerLogs=new Hono<Env>();
aiAnswerLogs.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'ai_log_unavailable'},e instanceof GapError?e.status:503));
aiAnswerLogs.use('/api/ai-answer-logs*',requirePermission('/auto-replies'));
function view(r:Record<string,unknown>,masked:boolean){return {testMode:String(r.id).startsWith(simulatedQaPrefix),id:r.id,createdAt:r.created_at,chatId:r.chat_id,friendId:r.friend_id,friendName:masked?null:r.friend_name,questionText:masked?'（非表示）':r.question_text,action:r.action,handoffReason:r.handoff_reason,qaEntryId:r.qa_entry_id,qaTitle:r.qa_title,qaVersion:r.qa_version};}
aiAnswerLogs.get('/api/ai-answer-logs',async c=>{
 const a=await gapAccount(c),offset=listQueryNumber(c.req.query('offset'), 0),action=c.req.query('action')??'';
 if(!Number.isSafeInteger(offset)||offset<0||action&&!['answered','handed_off','customer_asked_human'].includes(action))throw new GapError('invalid_filter');
 const where='l.account_id=? AND (?=\'\' OR l.action=?)',bind=[a,action,action];
 const total=await c.env.DB.prepare(`SELECT count(*) n FROM ai_answer_logs l WHERE ${where}`).bind(...bind).first<{n:number}>();
 const rows=(await c.env.DB.prepare(`SELECT l.*,f.display_name friend_name,json_extract(q.questions_json,'$[0]') qa_title FROM ai_answer_logs l LEFT JOIN friends f ON f.id=l.friend_id AND f.line_account_id=l.account_id LEFT JOIN qa_entries q ON q.id=l.qa_entry_id AND q.account_id=l.account_id WHERE ${where} ORDER BY l.created_at DESC,l.id LIMIT 20 OFFSET ?`).bind(...bind,offset).all<Record<string,unknown>>()).results;
 const summary=await c.env.DB.prepare(`SELECT count(CASE WHEN action='answered' AND id NOT LIKE 'ai-sim:%' THEN 1 END) answered,count(CASE WHEN action='handed_off' AND id NOT LIKE 'ai-sim:%' THEN 1 END) handedOff,count(CASE WHEN action='answered' AND id LIKE 'ai-sim:%' THEN 1 END) simulatedAnswered,count(CASE WHEN action!='answered' AND id LIKE 'ai-sim:%' THEN 1 END) simulatedHandedOff FROM ai_answer_logs WHERE account_id=?`).bind(a).first();
 return c.json({success:true,data:{items:rows.map(r=>view(r,!!c.get('impersonation'))),total:total?.n??0,summary:{...summary,askedAgainRate:null}}});
});
aiAnswerLogs.get('/api/ai-answer-logs/:id',async c=>{
 const a=await gapAccount(c),r=await c.env.DB.prepare('SELECT l.*,f.display_name friend_name FROM ai_answer_logs l LEFT JOIN friends f ON f.id=l.friend_id AND f.line_account_id=l.account_id WHERE l.id=? AND l.account_id=?').bind(c.req.param('id'),a).first<Record<string,unknown>>();if(!r)throw new GapError('not_found',404);
 const q=await c.env.DB.prepare('SELECT * FROM qa_entries WHERE id=? AND account_id=?').bind(r.qa_entry_id,a).first<Record<string,unknown>>();
 const answers=(s:unknown)=>{try{return (JSON.parse(String(s??'[]')) as Array<{text?:string}>).map(x=>x.text??'').join('\n');}catch{return null;}};
 return c.json({success:true,data:{...view(r,!!c.get('impersonation')),answerText:c.get('impersonation')?null:answers(r.answer_snapshot_json),qa:q?{id:q.id,title:JSON.parse(String(q.questions_json))[0],status:q.status,useCount:q.use_count,version:q.version,updatedAt:q.updated_at,currentAnswerText:answers(q.answer_messages_json)}:null,afterNote:c.get('impersonation')?null:String(r.id).startsWith(simulatedQaPrefix)?(JSON.parse(String(r.after_note??'{}')).customerAskedHumanAt?'模擬実行後にお客さまが人を希望（送信していません）':'模擬実行（送信していません）'):r.after_note??null}});
});
aiAnswerLogs.post('/api/ai-settings/test',requirePermission('/auto-replies'),async c=>{
 const a=await gapAccount(c),b=await gapBody(c);if(typeof b.question!=='string'||!b.question.trim()||b.question.length>500)throw new GapError('invalid_question');
 const result=await evaluateQa(c.env.DB,a,b.question);
 return c.json({success:true,data:{qaEntryId:result.qa?.id??null,qaTitle:result.qa?.title??null,handoffReason:result.handoffReason,action:result.action,messages:result.qa?.messages??[],sent:false,testMode:true}});
});

aiAnswerLogs.post('/api/ai-settings/simulate',requirePermission('/auto-replies'),async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c);
 if(b.testMode!==true)throw new GapError('test_mode_required');
 if(typeof b.chatId!=='string'||typeof b.question!=='string'||!b.question.trim()||b.question.length>500||b.kind!==undefined&&!['text','image','sticker','audio','video','file','location'].includes(String(b.kind)))throw new GapError('invalid_question');
 const data=await simulateQa(c.env.DB,{account:a,chatId:b.chatId,eventId:'manual:'+c.get('staff').id+':'+gapKey(c),question:b.question,kind:b.kind as string|undefined});
 return c.json({success:true,data});
});
