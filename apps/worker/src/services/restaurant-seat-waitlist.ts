/**
 * 席の空き待ち（booking-plus 6 の席対応）。
 *
 * 人の booking_waitlist と同じ考え方。違いは2つ。
 * - 枠に卓が無い（同じ店・同じ開始時刻）。組の人数が入る席だけが候補。
 * - 招待は空いた卓にひも付く（仮押さえは「店・開始時刻・卓」）。
 *
 * 取り消しで卓が空いたら、その卓に入る組の早い順に1組だけカードで知らせる。
 * 自動送信なので手動の印は付けない。
 */
import {
  buildWaitlistInviteBubble,
  formatSlotHeadline,
  sendWaitlistInviteCard,
  type WaitlistInviteSender,
} from './booking-waitlist-card.js';
import { readWaitlistHoldMinutes } from './booking-waitlist.js';
import { normalizeTimeZone, tzHHMM } from './availability.js';
import { resolveLineCredential } from '@line-crm/db';

export const DEFAULT_SEAT_WAITLIST_HOLD_MINUTES = 30;

export interface SeatWaitlistSlot {
  storeId: string;
  startsAt: string;
  tableId: string;
}

export interface SeatWaitlistEntry {
  id: string;
  store_id: string;
  starts_at: string;
  guest_count: number;
  customer_name: string;
  customer_phone: string | null;
  line_uid: string | null;
  identity_key: string;
  status: string;
  hold_minutes: number;
  table_id: string | null;
  invited_at: string | null;
  hold_expires_at: string | null;
  notified_at: string | null;
  created_at: string;
}

export type SeatPromoteResult =
  | { promoted: true; entry: SeatWaitlistEntry }
  | { promoted: false; reason: 'empty' | 'hold_active' | 'race' | 'no_fitting_table' };

interface FittingTable {
  id: string;
  label: string;
}

/** 組の人数が入る有効な卓。 */
export async function fittingSeatTables(
  db: D1Database,
  storeId: string,
  guestCount: number,
): Promise<FittingTable[]> {
  const rows = await db
    .prepare(`SELECT id, label FROM rt_tables
      WHERE store_id = ? AND is_active = 1
        AND min_capacity <= ? AND max_capacity >= ?
      ORDER BY max_capacity ASC, id ASC`)
    .bind(storeId, guestCount, guestCount)
    .all<{ id: string; label: string }>();
  return rows.results ?? [];
}

/**
 * 空いた卓に、入る組の早い順で1組を招く。
 *
 * - 同じ卓の仮押さえ中は招かない。期限切れは列の後ろへ回す。
 * - 空いた卓に入らない組は飛ばす（後の組が入れば招く）。
 * - 招待の確定を先に単文CASで行い、カード送信の失敗では枠を失わない。
 */
export async function promoteSeatWaitlist(
  db: D1Database,
  slot: SeatWaitlistSlot,
  sender: WaitlistInviteSender = sendWaitlistInviteCard,
  liffBaseUrl = '',
): Promise<SeatPromoteResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  const live = await db
    .prepare(
      `SELECT id FROM rt_seat_waitlist
        WHERE store_id = ? AND starts_at = ? AND table_id = ?
          AND status = 'invited' AND hold_expires_at > ?
        LIMIT 1`,
    )
    .bind(slot.storeId, slot.startsAt, slot.tableId, nowIso)
    .first<{ id: string }>();
  if (live) return { promoted: false, reason: 'hold_active' };

  await db
    .prepare(
      `UPDATE rt_seat_waitlist
          SET status = 'waiting', invited_at = NULL, hold_expires_at = NULL,
              table_id = NULL, created_at = ?,
              updated_at = datetime('now')
        WHERE store_id = ? AND starts_at = ? AND table_id = ?
          AND status = 'invited' AND hold_expires_at <= ?`,
    )
    .bind(nowIso, slot.storeId, slot.startsAt, slot.tableId, nowIso)
    .run();

  const table = await db
    .prepare(`SELECT id, label, min_capacity, max_capacity, is_active FROM rt_tables
      WHERE id = ? AND store_id = ?`)
    .bind(slot.tableId, slot.storeId)
    .first<{ id: string; label: string; min_capacity: number; max_capacity: number; is_active: number }>();
  if (!table || Number(table.is_active) !== 1) {
    return { promoted: false, reason: 'no_fitting_table' };
  }

  const next = await db
    .prepare(
      `SELECT * FROM rt_seat_waitlist
        WHERE store_id = ? AND starts_at = ? AND status = 'waiting'
          AND guest_count >= ? AND guest_count <= ?
        ORDER BY created_at ASC, rowid ASC LIMIT 1`,
    )
    .bind(slot.storeId, slot.startsAt, table.min_capacity, table.max_capacity)
    .first<SeatWaitlistEntry>();
  if (!next) return { promoted: false, reason: 'empty' };

  const holdMinutes = await readWaitlistHoldMinutesForStore(db, slot.storeId);
  const holdExpiresAt = new Date(now.getTime() + holdMinutes * 60_000).toISOString();
  const claimed = await db
    .prepare(
      `UPDATE rt_seat_waitlist
          SET status = 'invited', hold_minutes = ?, invited_at = ?,
              hold_expires_at = ?, table_id = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'waiting'`,
    )
    .bind(holdMinutes, nowIso, holdExpiresAt, slot.tableId, next.id)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return { promoted: false, reason: 'race' };
  }

  const entry: SeatWaitlistEntry = {
    ...next,
    status: 'invited',
    hold_minutes: holdMinutes,
    table_id: slot.tableId,
    invited_at: nowIso,
    hold_expires_at: holdExpiresAt,
  };

  if (entry.line_uid) {
    try {
      const target = await db
        .prepare(
          `SELECT la.channel_access_token, la.channel_access_token_encrypted,
                  s.timezone, s.line_account_id
             FROM rt_stores s
             LEFT JOIN line_accounts la ON la.id = s.line_account_id
            WHERE s.id = ?`,
        )
        .bind(slot.storeId)
        .first<{
          channel_access_token: string | null;
          channel_access_token_encrypted: string | null;
          timezone: string | null;
          line_account_id: string | null;
        }>();
      if (target?.line_account_id && target.channel_access_token) {
        const accessToken = await resolveLineCredential(
          target.channel_access_token_encrypted,
          target.channel_access_token,
          { lineAccountId: target.line_account_id, field: 'channel_access_token' },
        );
        const timeZone = normalizeTimeZone(target.timezone ?? 'Asia/Tokyo');
        const headline = formatSlotHeadline(slot.startsAt, timeZone);
        const holdEnd = tzHHMM(timeZone, new Date(holdExpiresAt));
        const base = liffBaseUrl.replace(/\/$/, '');
        await sender({
          channelAccessToken: accessToken,
          toLineUserId: entry.line_uid,
          bubble: buildWaitlistInviteBubble({
            headline,
            detail: `${entry.customer_name}様 ${entry.guest_count}名・${table.label}`,
            holdLine: `${holdEnd} まではこちらだけが予約できます。`,
            bookUrl: `${base}/booking?seat_waitlist=${encodeURIComponent(entry.id)}`,
            declineUrl: `${base}/booking/seat-waitlist/${entry.id}/decline`,
          }),
          altText: `${headline} に空きが出ました`,
        });
        await db
          .prepare(`UPDATE rt_seat_waitlist SET notified_at = ? WHERE id = ?`)
          .bind(nowIso, entry.id)
          .run();
        entry.notified_at = nowIso;
      }
    } catch {
      // 招待の主張は残っている。送信だけ店の画面からやり直せるよう落とさない。
      console.error(JSON.stringify({ event: 'seat_waitlist_invite_send_failed', waitlistId: entry.id }));
    }
  }
  return { promoted: true, entry };
}

/** 店の仮押さえ分数。booking_settings が無い店は既定30。 */
async function readWaitlistHoldMinutesForStore(
  db: D1Database,
  storeId: string,
): Promise<number> {
  try {
    const store = await db
      .prepare(`SELECT line_account_id FROM rt_stores WHERE id = ?`)
      .bind(storeId)
      .first<{ line_account_id: string | null }>();
    if (store?.line_account_id) {
      return await readWaitlistHoldMinutes(db, store.line_account_id);
    }
  } catch {
    // 列や表が無いDBでは既定で動く。
  }
  return DEFAULT_SEAT_WAITLIST_HOLD_MINUTES;
}
