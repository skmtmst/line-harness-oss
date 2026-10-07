import { couponDate, couponPayloadError } from '@line-crm/shared';
import { getBroadcastMessageAsset, toJstString, type Friend } from '@line-crm/db';

/** 署名検証済みWebhookだけが呼ぶ。1文で期限・回数・イベント再送を確かめる。 */
export async function redeemCoupon(db: D1Database, friend: Friend, accountId: string | null, assetId: string, eventId: string, now = new Date()): Promise<{ ok: boolean; message: string; replayed?: boolean }> {
  if (friend.line_account_id !== accountId) return { ok:false,message:'このクーポンは使えません' };
  const existing = await db.prepare('SELECT id FROM coupon_redemptions WHERE incoming_event_id = ? AND friend_id = ?').bind(eventId,friend.id).first();
  if (existing) return { ok: true, message: 'クーポンの使用を記録しました', replayed: true };
  const asset = await getBroadcastMessageAsset(db,assetId);
  if (!asset || asset.kind !== 'coupon' || Number(asset.published_version) < 1 || (asset.line_account_id !== null && asset.line_account_id !== accountId)) return { ok: false, message: 'このクーポンは使えません' };
  const payload = JSON.parse(asset.payload_json);
  if (couponPayloadError(payload)) return { ok: false, message: 'クーポンの設定を確認してください' };
  if (now.getTime() < couponDate(payload.startsAt)) return { ok: false, message: 'まだクーポンの利用期間ではありません' };
  if (now.getTime() >= couponDate(payload.endsAt)) return { ok: false, message: 'クーポンの期限が切れています' };
  const max = payload.maxUsesPerFriend ?? (payload.oncePerFriend === false ? null : 1);
  const result = await db.prepare(`INSERT OR IGNORE INTO coupon_redemptions
    (id,asset_id,friend_id,line_account_id,incoming_event_id,used_at,use_number,payload_snapshot)
    SELECT ?,?,?,?, ?,?, COUNT(*)+1,? FROM coupon_redemptions WHERE asset_id = ? AND friend_id = ?
    HAVING ? IS NULL OR COUNT(*) < ?`).bind(crypto.randomUUID(),asset.id,friend.id,accountId,eventId,toJstString(now),asset.payload_json,asset.id,friend.id,max,max).run();
  if (Number(result.meta.changes) > 0) return { ok: true, message: 'クーポンの使用を記録しました' };
  const replay = await db.prepare('SELECT id FROM coupon_redemptions WHERE incoming_event_id = ? AND friend_id = ?').bind(eventId,friend.id).first();
  return replay ? { ok: true, message: 'クーポンの使用を記録しました', replayed: true } : { ok: false, message: 'このクーポンは使える回数に達しています' };
}
