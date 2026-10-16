import {Hono,type Context} from 'hono';
import type {Env} from '../index.js';
import {GapError,gapAccount,gapBody,gapKey,gapVersion,gapWrite} from '../services/gap-common.js';
import {aiSettings,makeAiDraft} from '../services/ai-drafts.js';
import {hasStaffPermission,requirePermission} from '../middleware/role-guard.js';
export const aiDrafts=new Hono<Env>();
aiDrafts.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'ai_unavailable'},e instanceof GapError?e.status:503));
async function chat(c:Context<Env>){
 const row=await c.env.DB.prepare('SELECT c.id,c.friend_id,f.line_account_id FROM chats c JOIN friends f ON f.id=c.friend_id WHERE c.id=?').bind(c.req.param('id')).first<{id:string;friend_id:string;line_account_id:string}>();
 if(!row)throw new GapError('not_found',404);await gapAccount(c,row.line_account_id);

 return row;
}
aiDrafts.get('/api/ai-settings',requirePermission('/auto-replies'),async(c)=>{const a=await gapAccount(c);return c.json({success:true,data:{...await aiSettings(c.env.DB,a),autoReplyAvailable:false}});});
aiDrafts.put('/api/ai-settings',requirePermission('/auto-replies'),async(c)=>{
 const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion),im=c.get('impersonation');
 gapWrite(c,{admin:true,impersonation:b.mode==='off'||b.mode==='suspended'});
 if(im&&(b.mode!=='off'&&b.mode!=='suspended'))throw new GapError('IMPERSONATION_WRITE_BLOCKED',403);
 if(im&&(typeof b.reason!=='string'||!b.reason.trim()))throw new GapError('reason_required');
 if(b.mode==='auto_qa'){
  if(c.get('staff').role!=='owner')throw new GapError('owner_required',403);
  // 今回は要約と返信案まで。Webhookの自動送信を実装するまではオンにしない。
  throw new GapError('auto_qa_not_available',409);
 }
 if(!['off','draft_only','suspended'].includes(String(b.mode)))throw new GapError('invalid_ai_mode');if(b.mode==='draft_only'&&b.confirmed!==true)throw new GapError('confirmation_required');
 const r=await c.env.DB.prepare(`INSERT INTO ai_settings(account_id,mode,updated_by) SELECT ?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM ai_settings WHERE account_id=? AND version=?) ON CONFLICT(account_id) DO UPDATE SET mode=excluded.mode,updated_by=excluded.updated_by,version=version+1 WHERE version=?`).bind(a,b.mode,c.get('staff').id,v,a,v,v).run();if(!r.meta.changes)throw new GapError('version_conflict',409);
 return c.json({success:true,data:{...await aiSettings(c.env.DB,a),autoReplyAvailable:false}});
});
aiDrafts.post('/api/chats/:id/ai/summary',async(c)=>{const row=await chat(c);return c.json({success:true,data:await makeAiDraft(c.env.DB,{account:row.line_account_id,friend:row.friend_id,chat:row.id,kind:'summary',apiKey:c.env.OPENAI_API_KEY??'',masked:!!c.get('impersonation')})});});
aiDrafts.post('/api/chats/:id/ai/draft',async(c)=>{gapWrite(c);const row=await chat(c);if(!hasStaffPermission(c,'/chats'))throw new GapError('forbidden',403);return c.json({success:true,data:await makeAiDraft(c.env.DB,{account:row.line_account_id,friend:row.friend_id,chat:row.id,kind:'draft',apiKey:c.env.OPENAI_API_KEY??'',masked:false})});});
aiDrafts.get('/api/qa-entries',requirePermission('/auto-replies'),async(c)=>{
 const a=await gapAccount(c),query=c.req.query('q')??'',offset=Number(c.req.query('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||query.length>200)throw new GapError('invalid_pagination');
 const rows=(await c.env.DB.prepare("SELECT * FROM qa_entries WHERE account_id=? AND (questions_json LIKE ? OR answer_messages_json LIKE ?) ORDER BY updated_at DESC,id LIMIT 20 OFFSET ?").bind(a,`%${query}%`,`%${query}%`,offset).all()).results;
 const count=await c.env.DB.prepare('SELECT count(*) total FROM qa_entries WHERE account_id=? AND (questions_json LIKE ? OR answer_messages_json LIKE ?)').bind(a,`%${query}%`,`%${query}%`).first<{total:number}>();return c.json({success:true,data:rows,total:count?.total??0,nextOffset:rows.length===20?offset+20:null});
});
function qaBody(b:Record<string,unknown>){if(!Array.isArray(b.questions)||!b.questions.length||b.questions.length>20||b.questions.some(x=>typeof x!=='string'||!x.trim()||x.length>500)||typeof b.answer!=='string'||!b.answer.trim()||b.answer.length>5000)throw new GapError('invalid_qa');return {questions:b.questions as string[],answer:b.answer as string};}
aiDrafts.post('/api/qa-entries',requirePermission('/auto-replies'),async(c)=>{
 gapWrite(c);const a=await gapAccount(c),b=qaBody(await gapBody(c)),key=gapKey(c),actor=c.get('staff').id;
 await c.env.DB.prepare(`INSERT INTO qa_entries(id,account_id,questions_json,answer_messages_json,created_by,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,created_by,idempotency_key) DO NOTHING`).bind(crypto.randomUUID(),a,JSON.stringify(b.questions),JSON.stringify([{type:'text',text:b.answer}]),actor,new Date().toISOString(),key).run();
 const saved=await c.env.DB.prepare('SELECT * FROM qa_entries WHERE account_id=? AND created_by=? AND idempotency_key=?').bind(a,actor,key).first<{questions_json:string;answer_messages_json:string}>();if(saved?.questions_json!==JSON.stringify(b.questions)||saved.answer_messages_json!==JSON.stringify([{type:'text',text:b.answer}]))throw new GapError('idempotency_conflict',409);return c.json({success:true,data:saved},201);
});
aiDrafts.put('/api/qa-entries/:id',requirePermission('/auto-replies'),async(c)=>{
 gapWrite(c);const a=await gapAccount(c),raw=await gapBody(c),b=qaBody(raw),v=gapVersion(raw.expectedVersion),staff=c.get('staff');
 const r=await c.env.DB.prepare(`UPDATE qa_entries SET questions_json=?,answer_messages_json=?,status='draft',version=version+1,updated_at=? WHERE id=? AND account_id=? AND version=? AND (?=1 OR status='draft')`).bind(JSON.stringify(b.questions),JSON.stringify([{type:'text',text:b.answer}]),new Date().toISOString(),c.req.param('id'),a,v,['owner','admin'].includes(staff.role)?1:0).run();if(!r.meta.changes)throw new GapError('version_conflict_or_forbidden',409);return c.json({success:true,data:{version:v+1,status:'draft'}});
});
for(const [method,suffix,status] of [['post','publish','published'],['post','stop','stopped'],['delete','','stopped']] as const){
 const handler=async(c:Context<Env>)=>{gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion);const r=await c.env.DB.prepare('UPDATE qa_entries SET status=?,version=version+1,updated_at=? WHERE id=? AND account_id=? AND version=?').bind(status,new Date().toISOString(),c.req.param('id')!,a,v).run();if(!r.meta.changes)throw new GapError('version_conflict',409);return c.json({success:true,data:{status,version:v+1}});};
 if(method==='post')aiDrafts.post(`/api/qa-entries/:id/${suffix}`,requirePermission('/auto-replies'),handler);else aiDrafts.delete('/api/qa-entries/:id',requirePermission('/auto-replies'),handler);
}
