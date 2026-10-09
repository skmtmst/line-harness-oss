import { runActionRows, type ScenarioActionRow, type RunActionRowsOptions } from './scenario-actions.js';
import { applyTapExtras } from './tap-extras.js';
import { couponDate, couponPayloadError } from '@line-crm/shared';
import { getBroadcastMessageAsset, toJstString, type Friend } from '@line-crm/db';

async function confirmReceipt(db: D1Database, receiptId: string | undefined, now: Date) {
  if (receiptId) await db.prepare(`UPDATE entry_route_coupon_receipts
      SET status = CASE WHEN status IN ('pending', 'unknown') THEN 'received' ELSE status END,
        received_at = COALESCE(received_at, ?)
      WHERE id = ?`).bind(toJstString(now), receiptId).run();
}

/** 署名検証済みWebhookまたは本人確認済みLIFFが呼ぶ。1文で期限・回数・イベント再送を確かめる。 */
export async function redeemCoupon(db: D1Database, friend: Friend, accountId: string | null, assetId: string, eventId: string, now = new Date(), receiptId?: string, runtime: RunActionRowsOptions = {}): Promise<{ ok: boolean; message: string; replayed?: boolean }> {
  if (friend.line_account_id !== accountId) return { ok:false,message:'このクーポンは使えません' };
  const existing = await db.prepare('SELECT id FROM coupon_redemptions WHERE incoming_event_id = ? AND friend_id = ? AND asset_id = ? AND entry_route_coupon_receipt_id IS ?').bind(eventId,friend.id,assetId,receiptId ?? null).first();
  if (existing) {
    await confirmReceipt(db, receiptId, now);
    const snapshot = await db.prepare('SELECT payload_snapshot FROM coupon_redemptions WHERE incoming_event_id=? AND friend_id=?').bind(eventId,friend.id).first<{payload_snapshot:string}>();
    const payload = snapshot && JSON.parse(snapshot.payload_snapshot);
    if (payload?.tapExtras) await applyTapExtras(db,friend.id,accountId,payload.tapExtras,eventId);
    return { ok: true, message: 'クーポンの使用を記録しました', replayed: true };
  }
  const asset = await getBroadcastMessageAsset(db,assetId);
  if (!asset || asset.kind !== 'coupon' || Number(asset.published_version) < 1 || (asset.line_account_id !== null && asset.line_account_id !== accountId)) return { ok: false, message: 'このクーポンは使えません' };
  const receipt = receiptId ? await db.prepare(`SELECT payload_snapshot FROM entry_route_coupon_receipts
    WHERE id = ? AND asset_id = ? AND friend_id = ? AND line_account_id = ?
      AND status IN ('pending', 'unknown', 'received', 'sent')`).bind(receiptId, assetId, friend.id, accountId).first<{ payload_snapshot: string }>() : null;
  if (receiptId && !receipt) return { ok: false, message: 'このクーポンは使えません' };
  const payloadSnapshot = receipt?.payload_snapshot ?? asset.payload_json;
  let payload;
  try { payload = JSON.parse(payloadSnapshot); } catch { return { ok: false, message: 'クーポンの設定を確認してください' }; }
  if (couponPayloadError(payload)) return { ok: false, message: 'クーポンの設定を確認してください' };
  if (now.getTime() < couponDate(payload.startsAt)) return { ok: false, message: 'まだクーポンの利用期間ではありません' };
  if (now.getTime() >= couponDate(payload.endsAt)) return { ok: false, message: 'クーポンの期限が切れています' };
  const max = payload.maxUsesPerFriend ?? (payload.oncePerFriend === false ? null : 1);
  const result = await db.prepare(`INSERT OR IGNORE INTO coupon_redemptions
    (id,asset_id,friend_id,line_account_id,incoming_event_id,used_at,use_number,payload_snapshot,entry_route_coupon_receipt_id)
    SELECT ?,?,?,?, ?,?, COUNT(*)+1,?,? FROM coupon_redemptions WHERE asset_id = ? AND friend_id = ?
    HAVING ? IS NULL OR COUNT(*) < ?`).bind(crypto.randomUUID(),asset.id,friend.id,accountId,eventId,toJstString(now),payloadSnapshot,receiptId ?? null,asset.id,friend.id,max,max).run();
  if (Number(result.meta.changes) > 0) {
    await confirmReceipt(db, receiptId, now);
    if (payload.tapExtras) await applyTapExtras(db,friend.id,accountId,payload.tapExtras,eventId);
    try {
      const actions = Array.isArray(payload.useActions) ? payload.useActions : [];
      const rows = actions.map((action: { actionType: string; config?: unknown }, index: number) => ({
        id: `coupon:${eventId}:${index}`, scenario_id: '', hook: 'choice_selected', step_id: null,
        choice_index: null, sort_order: index, action_type: action.actionType,
        config_json: JSON.stringify(action.config ?? {}), condition_json: null, repeat_on_refire: 1,
      })) as ScenarioActionRow[];
      const effects = await runActionRows(db, rows, friend.id, { ...runtime, accountId, sourceEventId: eventId });
      if (effects.failed || effects.skippedIncomplete) return { ok: true, message: 'クーポンの使用を記録しました。使用後の処理に失敗したため、お店に確認してください' };
      return { ok: true, message: 'クーポンの使用を記録しました' };
    } catch { return { ok: true, message: 'クーポンの使用を記録しました。使用後の処理に失敗したため、お店に確認してください' }; }
  }
  const replay = await db.prepare('SELECT id FROM coupon_redemptions WHERE incoming_event_id = ? AND friend_id = ? AND asset_id = ? AND entry_route_coupon_receipt_id IS ?').bind(eventId,friend.id,assetId,receiptId ?? null).first();
  if (replay) return redeemCoupon(db, friend, accountId, assetId, eventId, now, receiptId, runtime);
  return { ok: false, message: 'このクーポンは使える回数に達しています' };
}
