import { fireEvent } from '../../services/event-bus.js';
import { jstNow } from '@line-crm/db';


/** Carry a stable change identity across every producer, including workflow replay. */
export async function emitTagChange(db: D1Database, friendId: string, tagId: string, action: 'add'|'remove', sourceId: string): Promise<void> {
  const friend = await db.prepare('SELECT line_account_id FROM friends WHERE id=?').bind(friendId).first<{line_account_id:string|null}>();
  await fireEvent(db, 'tag_change', {
    friendId, sourceEventId: `tag:${friendId}:${tagId}:${action}:${sourceId}`,
    sourceKind: 'friend_tag', occurredAt: new Date().toISOString(), eventData: {tagId, action},
  }, undefined, friend?.line_account_id);
}



/** フォーム工程の再開では、解除済みとイベントの結果不明を区別する。 */
export async function detachTagWithReceipt(db: D1Database, friendId: string, tagId: string, sourceEventId: string): Promise<{ removed: boolean }> {
  const sourceId = JSON.stringify([friendId,tagId,sourceEventId]);
  const read = () => db.prepare(`SELECT id,line_account_id,json_extract(after_json,'$.status') AS status
    FROM audit_events WHERE source_kind='friend_tag_detach' AND source_id=?`)
    .bind(sourceId).first<{id:string;line_account_id:string|null;status:string}>();
  let receipt = await read();
  let removed = false;
  if (!receipt) {
    const result = await db.batch([
      db.prepare('DELETE FROM friend_tags WHERE friend_id=? AND tag_id=?').bind(friendId,tagId),
      db.prepare(`INSERT INTO audit_events(id,source_kind,source_id,tenant_id,line_account_id,category,actor_role,action,target_kind,target_id,result,after_json)
        SELECT ?,'friend_tag_detach',?,COALESCE(a.tenant_id,'00000000-0000-4000-8000-000000000001'),f.line_account_id,
          'business','system','tag.detach','friend',f.id,'success','{"status":"pending"}'
        FROM friends f LEFT JOIN line_accounts a ON a.id=f.line_account_id WHERE f.id=? AND changes()=1`)
        .bind(crypto.randomUUID(),sourceId,friendId),
    ]);
    removed = (result[0].meta?.changes ?? 0) > 0;
    receipt = await read();
    if (!receipt) return {removed:false};
  }
  if (receipt.status === 'completed') return {removed};
  const hold = async () => {
    await db.batch([
      db.prepare(`UPDATE audit_events SET result='failed',reason='タグ解除後の通知結果が不明です' WHERE id=?`).bind(receipt!.id),
      db.prepare(`INSERT OR IGNORE INTO notifications(id,event_type,title,body,channel,category,line_account_id,metadata,created_at)
        VALUES (?,'friend_tag_detach_stuck','タグ解除後の処理を確認してください',
          'タグは外れましたが、後続処理の結果を確認できません。二重実行を避けるため自動ではやり直しません。',
          'dashboard','error',?,?,?)`)
        .bind(`tag-detach:${receipt!.id}`,receipt!.line_account_id,JSON.stringify({friendId,tagId,receiptId:receipt!.id}),jstNow()),
    ]);
    throw new Error('タグ解除後の処理結果が不明です。通知センターで確認してください');
  };
  const claimed = await db.prepare(`UPDATE audit_events SET after_json='{"status":"running"}'
    WHERE id=? AND json_extract(after_json,'$.status')='pending'`).bind(receipt.id).run();
  if (!(claimed.meta?.changes ?? 0)) return hold();
  try {
    await emitTagChange(db, friendId, tagId, 'remove', receipt.id);
    await db.prepare(`UPDATE audit_events SET after_json='{"status":"completed"}',result='success',reason=NULL WHERE id=?`)
      .bind(receipt.id).run();
  } catch {
    // 部分送信・加点済みかもしれない。失敗理由に顧客本文を載せず、明示的な確認待ちへ。
    return hold();
  }
  return {removed};
}
