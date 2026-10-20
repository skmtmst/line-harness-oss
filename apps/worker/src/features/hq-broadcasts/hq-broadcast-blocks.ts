/** Count observed unfollows among successful recipients; never infer causality or fill coverage gaps with zero. */
export async function hqBroadcastBlocks(db:D1Database,tenantId:string,runId:string) {
  const rows=(await db.prepare(`SELECT t.line_account_id account_id,b.sent_at,c.state coverage_state,c.available_from,
    (SELECT COUNT(*) FROM broadcast_send_claims s WHERE s.broadcast_id=b.id AND s.line_account_id=t.line_account_id AND s.state='sent') sent,
    (SELECT COUNT(DISTINCT e.friend_id) FROM analytics_events e JOIN broadcast_send_claims s ON s.friend_id=e.friend_id AND s.broadcast_id=b.id AND s.line_account_id=t.line_account_id AND s.state='sent'
      WHERE e.line_account_id=t.line_account_id AND e.event_type='friend_unfollow' AND julianday(e.occurred_at)>=julianday(b.sent_at) AND julianday(e.occurred_at)<julianday(b.sent_at,'+14 days')) blocked
    FROM hq_broadcast_targets t JOIN line_accounts a ON a.id=t.line_account_id AND a.tenant_id=?
    JOIN broadcasts b ON b.id=t.broadcast_id AND b.line_account_id=t.line_account_id
    LEFT JOIN analytics_event_coverage c ON c.line_account_id=t.line_account_id AND c.event_type='friend_unfollow'
    WHERE t.run_id=? AND t.excluded=0 AND b.sent_at IS NOT NULL ORDER BY t.line_account_id`).bind(tenantId,runId).all<{account_id:string;sent_at:string;coverage_state:string|null;available_from:string|null;sent:number;blocked:number}>()).results;
  const blocksByAccount=rows.map(r=>{
    const covered=r.coverage_state==='available'&&r.available_from!==null&&Number.isFinite(Date.parse(r.available_from))&&Date.parse(r.available_from)<=Date.parse(r.sent_at);
    const state=!covered?'unavailable':r.sent<20?'insufficient':'available';
    return {accountId:r.account_id,blockCount:state==='available'?r.blocked:null,state,reason:!covered?'UNFOLLOW_COVERAGE_UNAVAILABLE':r.sent<20?'INSUFFICIENT_RECIPIENTS':null,windowComplete:Date.now()>=Date.parse(r.sent_at)+14*86400000};
  });
  const available=blocksByAccount.length>0&&blocksByAccount.every(r=>r.state==='available');
  return {blockCount:available?blocksByAccount.reduce((n,r)=>n+r.blockCount!,0):null,blockCountState:available?'available':blocksByAccount.some(r=>r.state==='unavailable')||!rows.length?'unavailable':'insufficient',blockCountUnavailableReason:available?null:rows.length?'COVERAGE_OR_SAMPLE_INSUFFICIENT':'NOT_SENT',blocksByAccount};
}
