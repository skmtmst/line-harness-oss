import { jstNow } from '@line-crm/db';

/** 宛先の写しを失った旧配信は、現在の条件で補わず要確認で止める。 */
export async function holdMissingBroadcastAudience(db: D1Database, input: {
  id: string; expected: number; known: number; started: boolean;
}): Promise<boolean> {
  if (!input.started || (input.known > 0 && (input.expected <= 0 || input.known >= input.expected))) return false;
  const at = jstNow();
  const reason = '開始時の宛先を確認できないため要確認です。現在の条件で取り直さず送信を止めました';
  await db.batch([
    db.prepare(`UPDATE broadcasts SET stopped_at=COALESCE(stopped_at,?),batch_offset=0,batch_lock_at=NULL WHERE id=?`)
      .bind(at,input.id),
    db.prepare(`INSERT INTO broadcast_lifecycle_events(id,broadcast_id,action,reason,detail_json,created_at)
      VALUES (?,?,'stopped',?,?,?)`).bind(crypto.randomUUID(),input.id,reason,
        JSON.stringify({code:'recipient_snapshot_missing',expected:input.expected,known:input.known}),at),
  ]);
  return true;
}
