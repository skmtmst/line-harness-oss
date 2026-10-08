import type { BroadcastApprovalState, HqBroadcastPreflight } from '@line-crm/shared';
import { getBroadcastApprovalThreshold } from './broadcast-approval.js';
import { StampError } from './visit-stamps.js';
import { preflightHqBroadcast, getHqBroadcastRun } from './hq-broadcasts.js';

type Run=Awaited<ReturnType<typeof getHqBroadcastRun>>;
type Approval=BroadcastApprovalState['approval'];
export function readHqApproval(run:Run):Approval {
  return run.approval_json?JSON.parse(run.approval_json):{status:'none',requestedByStaffId:null,requestedAt:null,approverStaffId:null,note:null,
    decidedByStaffId:null,decidedAt:null,rejectReason:null,confirmedCount:null};
}
export async function hqBroadcastApprovalCandidates(db:D1Database,tenantId:string) {
  return (await db.prepare(`SELECT id,name,role FROM staff_members WHERE tenant_id=? AND is_active=1 AND role IN ('owner','admin')
    AND invite_status='active' AND access_level<>'read_only' AND account_scope<>'accounts' ORDER BY name,id`).bind(tenantId).all<{id:string;name:string;role:string}>()).results;
}
export async function hqBroadcastApprovalState(db:D1Database,run:Run,actorId:string,checks?:HqBroadcastPreflight[]):Promise<BroadcastApprovalState> {
  const targets=checks??await preflightHqBroadcast(db,run,false),selected=targets.filter(t=>!t.excluded);
  let threshold=1000000;
  for(const t of selected)threshold=Math.min(threshold,await getBroadcastApprovalThreshold(db,{target_type:'all',line_account_id:t.accountId} as import('@line-crm/db').Broadcast));
  const recipientCount=selected.reduce((n,t)=>n+(t.audienceCount??0),0);
  const candidates=await hqBroadcastApprovalCandidates(db,run.tenant_id),approval=readHqApproval(run);
  const canApprove=run.status==='prepared'&&approval.status==='pending'&&actorId!==approval.requestedByStaffId
    &&approval.approverStaffId===actorId&&candidates.some(c=>c.id===actorId);
  return {approval,gate:{required:recipientCount>=threshold,recipientCount,threshold,singleOperator:candidates.length<=1,operatorCount:candidates.length},
    viewer:{isApprover:approval.approverStaffId===actorId,canApprove,isRequester:approval.requestedByStaffId===actorId}};
}
export async function updateHqApproval(db:D1Database,run:Run,actorId:string,action:'request'|'approve'|'reject'|'cancel',body:Record<string,unknown>) {
  if(run.status!=='prepared'||!Number.isSafeInteger(body.expectedVersion))throw new StampError('下書きと版を確認してください',409);
  const state=await hqBroadcastApprovalState(db,run,actorId),now=new Date().toISOString();
  let approval:Approval={...state.approval};
  if(action==='request') {
    const candidates=await hqBroadcastApprovalCandidates(db,run.tenant_id);
    if(!state.gate.required||state.gate.singleOperator||typeof body.approverStaffId!=='string'||body.approverStaffId===actorId
      ||!candidates.some(c=>c.id===body.approverStaffId))throw new StampError('別の統括担当者を選んでください');
    if(body.note!=null&&(typeof body.note!=='string'||body.note.length>2000))throw new StampError('承認メモを確認してください');
    approval={status:'pending',requestedByStaffId:actorId,requestedAt:now,approverStaffId:body.approverStaffId,note:body.note as string??null,
      decidedByStaffId:null,decidedAt:null,rejectReason:null,confirmedCount:state.gate.recipientCount};
  } else if(action==='cancel') {
    if(state.approval.requestedByStaffId!==actorId||!['pending','approved'].includes(state.approval.status))throw new StampError('依頼した人だけ取り消せます',403);
    approval={...approval,status:'cancelled',decidedByStaffId:actorId,decidedAt:now};
  } else {
    if(!state.viewer.canApprove)throw new StampError('承認を頼まれた別の担当者だけ決められます',403);
    if(action==='approve'&&state.approval.confirmedCount!==state.gate.recipientCount)throw new StampError('人数が変わりました。承認を依頼し直してください',409);
    if(action==='reject'&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000))throw new StampError('差し戻し理由を入れてください');
    approval={...approval,status:action==='approve'?'approved':'rejected',decidedByStaffId:actorId,decidedAt:now,rejectReason:action==='reject'?body.reason as string:null};
  }
  const token=crypto.randomUUID();
  const result=await db.batch([
    db.prepare(`UPDATE hq_broadcast_runs SET approval_json=?,dispatch_token=?,version=version+1,updated_at=datetime('now') WHERE id=? AND tenant_id=? AND status='prepared' AND version=?`)
      .bind(JSON.stringify(approval),token,run.id,run.tenant_id,body.expectedVersion),
    db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,'',?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`)
      .bind(crypto.randomUUID(),run.id,actorId,`approval_${action}`,run.id,token),
  ]);
  if(!result[0].meta.changes)throw new StampError('配信が更新されました。読み直してください',409);
  return hqBroadcastApprovalState(db,await getHqBroadcastRun(db,run.tenant_id,run.id),actorId);
}
