import { getBroadcastMessageAsset, getEntryRouteById, toJstString, type EntryRoute, type Friend } from '@line-crm/db';
import { couponDate, couponPayloadError, convertBroadcastAsset } from '@line-crm/shared';
import type { Message } from '@line-crm/line-sdk';

export interface EntryCouponReceipt {
  id: string;
  entry_route_id: string;
  asset_id: string;
  friend_id: string;
  line_account_id: string;
  status: 'pending' | 'received' | 'sent' | 'failed' | 'unknown';
  asset_name: string;
  payload_snapshot: string;
  received_at: string | null;
}

/** 公開した版だけを使う。下書き・終了・所属違いは受け付けない。 */
export async function availableEntryCoupon(db: D1Database, assetId: string, accountId: string, now = new Date()) {
  const asset = await getBroadcastMessageAsset(db, assetId);
  if (!asset || asset.kind !== 'coupon' || asset.published_version < 1
    || asset.line_account_id !== accountId) return null;
  try {
    const payload = JSON.parse(asset.payload_json);
    if (couponPayloadError(payload) || now.getTime() < couponDate(payload.startsAt)
      || now.getTime() >= couponDate(payload.endsAt)) return null;
    return asset;
  } catch { return null; }
}

/** INSERTの条件でも停止・所属・公開版を確認し、並行するfollow/LIFFを1件にする。 */
async function claimReceipt(db: D1Database, route: EntryRoute, friend: Pick<Friend, 'id' | 'line_account_id'>,
  source: 'follow' | 'liff', now: Date): Promise<{ receipt: EntryCouponReceipt; claimed: boolean } | null> {
  const accountId = friend.line_account_id;
  if (!accountId || route.line_account_id !== accountId || route.is_active !== 1
    || route.coupon_enabled !== 1 || !route.coupon_asset_id) return null;
  const asset = await availableEntryCoupon(db, route.coupon_asset_id, accountId, now);
  if (!asset) return null;
  const existing = await db.prepare('SELECT * FROM entry_route_coupon_receipts WHERE entry_route_id = ? AND friend_id = ?')
    .bind(route.id, friend.id).first<EntryCouponReceipt>();
  if (existing) {
    if (existing.asset_id !== asset.id) return null;
    // 確実に送っていない失敗だけ、同じ受け取りIDで再試行する。
    if (source === 'follow' && existing.status === 'failed') {
      const retry = await db.prepare(`UPDATE entry_route_coupon_receipts SET status = 'pending'
        WHERE id = ? AND status = 'failed' AND asset_id = ? AND payload_snapshot = ?`)
        .bind(existing.id, asset.id, asset.payload_json).run();
      return { receipt: existing, claimed: Number(retry.meta.changes) > 0 };
    }
    return { receipt: existing, claimed: false };
  }
  if (source === 'liff' && route.coupon_audience !== 'all_friends') return null;
  const id = crypto.randomUUID();
  const timestamp = toJstString(now);
  const result = await db.prepare(`INSERT OR IGNORE INTO entry_route_coupon_receipts
    (id, entry_route_id, asset_id, friend_id, line_account_id, status, asset_name, payload_snapshot, created_at, received_at)
    SELECT ?, er.id, a.id, f.id, er.line_account_id, ?, a.name, a.payload_json, ?, ?
    FROM entry_routes er JOIN broadcast_message_assets a ON a.id = er.coupon_asset_id
    JOIN friends f ON f.id = ? AND f.line_account_id = er.line_account_id AND f.is_following = 1
    WHERE er.id = ? AND er.is_active = 1 AND er.coupon_enabled = 1
      AND er.line_account_id = ? AND a.line_account_id = er.line_account_id AND a.kind = 'coupon'
      AND a.published_version = ? AND a.payload_json = ?
      AND (? = 'follow' OR er.coupon_audience = 'all_friends')`)
    .bind(id, source === 'follow' ? 'pending' : 'received', timestamp, source === 'liff' ? timestamp : null,
      friend.id, route.id, accountId, asset.published_version, asset.payload_json, source).run();
  const receipt = await db.prepare('SELECT * FROM entry_route_coupon_receipts WHERE entry_route_id = ? AND friend_id = ?')
    .bind(route.id, friend.id).first<EntryCouponReceipt>();
  return receipt ? { receipt, claimed: Number(result.meta.changes) > 0 } : null;
}

export function entryCouponMessage(receipt: EntryCouponReceipt): Message {
  const converted = convertBroadcastAsset('coupon', receipt.asset_name, {
    ...JSON.parse(receipt.payload_snapshot), assetId: receipt.asset_id,
  });
  if (!converted.ok) throw new Error('entry_coupon_payload_invalid');
  const contents = JSON.parse(converted.message.messageContent);
  contents.footer.contents[0].action.data = `coupon_use:${receipt.asset_id}:${receipt.id}`;
  return { type: 'flex', altText: converted.message.altText ?? receipt.asset_name, contents };
}

/** 新規followの署名検証と送信権の確認は呼び出し元。送達不明は送り直さない。 */
export async function sendEntryRouteCoupon(db: D1Database, route: EntryRoute,
  friend: Pick<Friend, 'id' | 'line_account_id'>,
  send: (message: Message, retryKey: string) => Promise<void>, now = new Date()) {
  const claim = await claimReceipt(db, route, friend, 'follow', now);
  if (!claim?.claimed) return false;
  // 同じ受け取りIDをLINEのretry keyに使い、受け取り後のDB障害でも二重送信を防ぐ。
  try {
    const current = await getEntryRouteById(db, route.id);
    if (!current || current.is_active !== 1 || current.coupon_enabled !== 1
      || current.coupon_asset_id !== claim.receipt.asset_id
      || !await availableEntryCoupon(db, claim.receipt.asset_id, claim.receipt.line_account_id, now)) {
      await db.prepare("UPDATE entry_route_coupon_receipts SET status = 'failed' WHERE id = ? AND status = 'pending'")
        .bind(claim.receipt.id).run();
      return false;
    }
    await send(entryCouponMessage(claim.receipt), claim.receipt.id);
  } catch (error) {
    const statusCode = Number((error as { status?: number })?.status ?? 0);
    const definite = (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) || (error as { friendAddSendAborted?: boolean })?.friendAddSendAborted;
    await db.prepare('UPDATE entry_route_coupon_receipts SET status = ? WHERE id = ? AND status = ?')
      .bind(definite ? 'failed' : 'unknown', claim.receipt.id, 'pending').run();
    throw error;
  }
  await db.prepare("UPDATE entry_route_coupon_receipts SET status = 'sent', received_at = ? WHERE id = ? AND status = 'pending'")
    .bind(toJstString(now), claim.receipt.id).run();
  return true;
}

/** 本人確認済みLIFFで、既存友だちにも同じ受け取りを返す（再読込では増やさない）。 */
export async function receiveEntryRouteCoupon(db: D1Database, route: EntryRoute,
  friend: Pick<Friend, 'id' | 'line_account_id'>, now = new Date()) {
  const claim = await claimReceipt(db, route, friend, 'liff', now);
  if (!claim || !['received', 'sent'].includes(claim.receipt.status)) return null;
  const used = await db.prepare('SELECT COUNT(*) AS n FROM coupon_redemptions WHERE entry_route_coupon_receipt_id = ?')
    .bind(claim.receipt.id).first<{ n: number }>();
  return {
    receiptId: claim.receipt.id, assetId: claim.receipt.asset_id, name: claim.receipt.asset_name,
    payload: JSON.parse(claim.receipt.payload_snapshot) as Record<string, unknown>,
    receivedAt: claim.receipt.received_at, usedCount: Number(used?.n ?? 0),
    postbackData: `coupon_use:${claim.receipt.asset_id}:${claim.receipt.id}`,
  };
}
