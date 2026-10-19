import { BookingLineDeliveryIncomplete } from '../features/booking/booking-line-delivery/index.js';
import { activeTenantLineAccountSql, isOperationCapabilityStopped } from '@line-crm/db';
import { featureJobCanRun } from './feature-enforcement.js';
import type { EventWaitlistOfferSender } from './event-waitlist-sender.js';

type Offer = Parameters<EventWaitlistOfferSender>[0];
const SOURCE = 'event_waitlist_offer';

/** offered の更新と同じ batch に積む。送信前の中断でも原文・承諾URLを保持する。 */
export function eventWaitlistDeliveryStatements(
  db: D1Database, offer: Offer, tokenHash: string, nowIso: string,
): D1PreparedStatement[] {
  const instanceId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  const key = `event-waitlist-offer:${offer.waitlistId}:${tokenHash}`;
  return [
    db.prepare(`INSERT OR IGNORE INTO notification_instances
      (id,line_account_id,audience_type,source_event_type,source_event_id,source_metadata_json,dedupe_key,created_at,updated_at)
      SELECT ?,?,'customer',?,?,?, ?,?,? WHERE EXISTS (
        SELECT 1 FROM event_waitlist WHERE id = ? AND line_account_id = ?
          AND status = 'offered' AND offer_token_hash = ?)`)
      .bind(instanceId, offer.lineAccountId, SOURCE, offer.waitlistId,
        JSON.stringify({ offer: { ...offer, retryKey: deliveryId }, tokenHash }), key, nowIso, nowIso,
        offer.waitlistId, offer.lineAccountId, tokenHash),
    db.prepare(`INSERT OR IGNORE INTO notification_deliveries
      (id,line_account_id,instance_id,audience_type,recipient_type,recipient_id,channel,idempotency_key,queued_at,updated_at)
      SELECT ?,?,id,'customer','friend',?,'line',?,?,? FROM notification_instances
      WHERE line_account_id = ? AND dedupe_key = ?`)
      .bind(deliveryId, offer.lineAccountId, offer.friendId, key, nowIso, nowIso, offer.lineAccountId, key),
  ];
}

/** 送信の前に「結果不明」を確保する。開始済みは再取得せず、通知の失敗一覧に残す。 */
export async function dispatchPendingEventWaitlistOffers(
  db: D1Database,
  params: { now: Date; sender: EventWaitlistOfferSender; waitlistId?: string; limit?: number },
): Promise<void> {
  const nowIso = params.now.toISOString();
  await recordLegacyUnknownOffers(db, nowIso, params.limit ?? 50);
  const rows = await db.prepare(`SELECT d.id, d.instance_id, d.line_account_id,
      i.source_event_id, i.source_metadata_json
    FROM notification_deliveries d JOIN notification_instances i ON i.id = d.instance_id
      AND i.line_account_id = d.line_account_id
    JOIN event_waitlist w ON w.id = i.source_event_id AND w.line_account_id = d.line_account_id
    JOIN event_slots s ON s.id = w.slot_id
    WHERE i.source_event_type = ? AND d.status = 'pending'
      AND w.status = 'offered' AND w.offer_expires_at > ? AND s.starts_at > ?
      AND (? IS NULL OR w.id = ?) AND ${activeTenantLineAccountSql('d.line_account_id')}
    ORDER BY d.queued_at, d.id LIMIT ?`)
    .bind(SOURCE, nowIso, nowIso, params.waitlistId ?? null, params.waitlistId ?? null, params.limit ?? 50)
    .all<{ id: string; instance_id: string; line_account_id: string; source_event_id: string; source_metadata_json: string }>();
  for (const row of rows.results ?? []) {
    if (!await featureJobCanRun(db, { accountId: row.line_account_id, featureId: 'events', job: 'event waitlist offers' })
      || await isOperationCapabilityStopped(db, row.line_account_id, 'reminder_dispatch')) continue;
    const payload = JSON.parse(row.source_metadata_json) as { offer: Offer; tokenHash: string };
    const claimed = await db.prepare(`UPDATE notification_deliveries
      SET status = 'failed', retryable = 0, attempts = attempts + 1, version = version + 1,
        error_code = 'delivery_unknown', error_message_safe = '案内の送信結果が不明です。自動再送せず確認してください。',
        failed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending' AND EXISTS (
        SELECT 1 FROM event_waitlist w WHERE w.id = ? AND w.status = 'offered'
          AND w.offer_token_hash = ? AND w.offer_expires_at > ?)`)
      .bind(nowIso, nowIso, row.id, row.source_event_id, payload.tokenHash, nowIso).run();
    if ((claimed.meta?.changes ?? 0) !== 1) continue;
    // 外部に渡す直前から応答保存までの中断は受理の有無が分からない。自動で二度送らない。
    try { await params.sender(payload.offer); }
    catch(error) {
      if(error instanceof BookingLineDeliveryIncomplete&&error.beforeSend) {
        // 遮断/停止で0要求なら送信待ちへ戻す。unknownの要求は取り直さない。
        await db.prepare(`UPDATE notification_deliveries SET status='pending',attempts=MAX(0,attempts-1),
          error_code=NULL,error_message_safe=NULL,failed_at=NULL,updated_at=?,version=version+1
          WHERE id=? AND status='failed' AND error_code='delivery_unknown'`)
          .bind(nowIso,row.id).run();
        continue;
      }
      throw error;
    }
    await db.batch([
      db.prepare(`UPDATE notification_deliveries SET status = 'provider_accepted', accepted_at = ?,
        failed_at = NULL, error_code = NULL, error_message_safe = NULL, updated_at = ?, version = version + 1
        WHERE id = ? AND status = 'failed' AND error_code = 'delivery_unknown'`).bind(nowIso, nowIso, row.id),
      db.prepare(`UPDATE notification_instances SET status = 'completed', updated_at = ? WHERE id = ?`)
        .bind(nowIso, row.instance_id),
      db.prepare(`UPDATE event_waitlist SET notified_at = ?, updated_at = ?
        WHERE id = ? AND status = 'offered' AND offer_token_hash = ?`)
        .bind(nowIso, nowIso, row.source_event_id, payload.tokenHash),
    ]);
  }
}

/** 旧版は送信開始の記録がない。未通知に見えても受理済みかもしれないため、人の確認へ渡す。 */
async function recordLegacyUnknownOffers(db: D1Database, nowIso: string, limit: number): Promise<void> {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO notification_instances
      (id,line_account_id,audience_type,source_event_type,source_event_id,source_metadata_json,dedupe_key,status,created_at,updated_at)
      SELECT 'event-offer-unknown:' || w.id || ':' || w.offer_token_hash, w.line_account_id,
        'customer', ?, w.id, json_object('tokenHash', w.offer_token_hash),
        'event-waitlist-offer:' || w.id || ':' || w.offer_token_hash, 'failed', ?, ?
      FROM event_waitlist w WHERE w.status = 'offered' AND w.notified_at IS NULL
        AND w.offer_token_hash IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM notification_instances i WHERE i.source_event_type = ?
            AND i.line_account_id = w.line_account_id AND i.source_event_id = w.id
            AND json_extract(i.source_metadata_json, '$.tokenHash') = w.offer_token_hash)
      ORDER BY w.offered_at, w.id LIMIT ?`).bind(SOURCE, nowIso, nowIso, SOURCE, limit),
    db.prepare(`INSERT OR IGNORE INTO notification_deliveries
      (id,line_account_id,instance_id,audience_type,recipient_type,recipient_id,channel,idempotency_key,
       status,retryable,error_code,error_message_safe,queued_at,updated_at)
      SELECT i.id, i.line_account_id, i.id, 'customer', 'friend', w.friend_id, 'line', i.dedupe_key,
        'failed', 0, 'delivery_unknown', '案内の送信結果が不明です。自動再送せず確認してください。', ?, ?
      FROM notification_instances i JOIN event_waitlist w ON w.id = i.source_event_id
        AND w.line_account_id = i.line_account_id
      WHERE i.source_event_type = ? AND i.status = 'failed' AND i.id LIKE 'event-offer-unknown:%'
        AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.instance_id = i.id)
      LIMIT ?`).bind(nowIso, nowIso, SOURCE, limit),
  ]);
}
