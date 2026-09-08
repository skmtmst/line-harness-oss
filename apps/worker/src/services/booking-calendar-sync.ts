import { GoogleCalendarClient, type BusyInterval } from './google-calendar.js';
import {
  getGoogleServiceAccountToken,
  type GoogleServiceAccountCredentials,
} from './google-service-account.js';
import {
  findBookingOperation,
  finishBookingOperation,
  queueBookingOperation,
} from './booking-operation-runs.js';

export interface StaffCalendarConnection {
  id: string;
  calendar_id: string;
  auth_type: string;
  access_token: string | null;
}

export async function getStaffCalendarConnection(
  db: D1Database,
  lineAccountId: string,
  staffId: string,
): Promise<StaffCalendarConnection | null> {
  return db
    .prepare(
      `SELECT id, calendar_id, auth_type, access_token
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(lineAccountId, staffId)
    .first<StaffCalendarConnection>();
}

async function clientForConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleServiceAccountCredentials,
): Promise<GoogleCalendarClient> {
  const accessToken = connection.auth_type === 'service_account'
    ? await getGoogleServiceAccountToken(credentials)
    : connection.access_token;
  if (!accessToken) throw new Error('google_calendar_access_token_missing');
  return new GoogleCalendarClient({ calendarId: connection.calendar_id, accessToken });
}

export async function getStaffGoogleBusy(
  db: D1Database,
  credentials: GoogleServiceAccountCredentials,
  input: { lineAccountId: string; staffId: string; timeMin: string; timeMax: string },
): Promise<BusyInterval[] | null> {
  const connection = await getStaffCalendarConnection(db, input.lineAccountId, input.staffId);
  if (!connection) return null;
  const client = await clientForConnection(connection, credentials);
  return client.getFreeBusy(input.timeMin, input.timeMax);
}

export async function verifyStaffCalendarConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleServiceAccountCredentials,
): Promise<void> {
  const client = await clientForConnection(connection, credentials);
  const now = new Date();
  await client.getFreeBusy(now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
}

/** Create the external event once a booking becomes confirmed. */
export async function syncConfirmedBookingToGoogle(
  db: D1Database,
  credentials: GoogleServiceAccountCredentials,
  bookingId: string,
): Promise<{ synced: boolean; eventId?: string; calendarId?: string }> {
  const row = await db
    .prepare(
      `SELECT b.id, b.starts_at, b.ends_at, b.customer_note, b.external_event_id,
              COALESCE(f.display_name, bc.display_name) AS customer_name, m.name AS menu_name,
              s.display_name AS staff_name,
              gc.id AS connection_id, gc.calendar_id, gc.auth_type, gc.access_token
         FROM bookings b
         LEFT JOIN friends f ON f.id = b.friend_id
         LEFT JOIN booking_customers bc ON bc.id = b.booking_customer_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN google_calendar_connections gc
           ON gc.line_account_id = b.line_account_id
          AND gc.staff_id = b.staff_id
          AND gc.is_active = 1
        WHERE b.id = ? AND b.status = 'confirmed'`,
    )
    .bind(bookingId)
    .first<{
      id: string;
      starts_at: string;
      ends_at: string;
      customer_note: string | null;
      external_event_id: string | null;
      customer_name: string | null;
      menu_name: string;
      staff_name: string;
      connection_id: string | null;
      calendar_id: string | null;
      auth_type: string | null;
      access_token: string | null;
    }>();
  if (!row || row.external_event_id || !row.connection_id || !row.calendar_id || !row.auth_type) {
    return { synced: false };
  }

  const connection: StaffCalendarConnection = {
    id: row.connection_id,
    calendar_id: row.calendar_id,
    auth_type: row.auth_type,
    access_token: row.access_token,
  };
  const client = await clientForConnection(connection, credentials);
  const created = await client.createEvent({
    summary: `${row.customer_name ?? 'お客様'}｜${row.menu_name}`,
    start: row.starts_at,
    end: row.ends_at,
    description: [
      `LINE Harness予約（担当: ${row.staff_name}）`,
      `予約ID: ${row.id}`,
      row.customer_note ? `メモ: ${row.customer_note}` : '',
    ].filter(Boolean).join('\n'),
  });
  await db
    .prepare(
      `UPDATE bookings
          SET external_event_id = ?, external_calendar_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND external_event_id IS NULL`,
    )
    .bind(created.eventId, row.calendar_id, bookingId)
    .run();
  return { synced: true, eventId: created.eventId, calendarId: row.calendar_id };
}

/**
 * 取消時の Calendar 削除を台帳駆動で1回だけ確実に行う。
 *
 * 安定キー (`<bookingId>:google-calendar:delete`) で台帳行を1行に保つ。
 * - ずみ (succeeded/skipped) なら外部へ触らず返す (二重削除なし)。
 * - 消す物が無ければ skipped で閉じる (外部へ出ない)。
 * - 一時失敗は retry_wait で残し、次の取消再試行で同じ鍵で再実行する。
 * - 外部成功→台帳失敗の間は queued のまま残るため、再実行は相手先の
 *   410 (削除ずみ) を成功として回収する (deleteEvent が吸収する)。
 * 投げない (取消処理を壊さない)。DB自体が使えないときだけ投げる。
 */
export async function runCalendarDeleteOperation(
  db: D1Database,
  input: {
    bookingId: string;
    lineAccountId: string;
    now?: Date;
    remove: () => Promise<void>;
  },
): Promise<'succeeded' | 'skipped' | 'retry_wait'> {
  const now = (input.now ?? new Date()).toISOString();
  const idempotencyKey = `${input.bookingId}:google-calendar:delete`;
  try {
    const existing = await findBookingOperation(db, {
      lineAccountId: input.lineAccountId,
      idempotencyKey,
    });
    if (existing && (existing.status === 'succeeded' || existing.status === 'skipped')) {
      return existing.status;
    }
    const operationId = existing?.id ?? await queueBookingOperation(db, {
      bookingId: input.bookingId,
      lineAccountId: input.lineAccountId,
      kind: 'google_calendar',
      idempotencyKey,
      result: { direction: 'delete' },
    });
    const booking = await db.prepare(
      `SELECT external_event_id FROM bookings WHERE id = ?`,
    ).bind(input.bookingId).first<{ external_event_id: string | null }>();
    if (!booking?.external_event_id) {
      await finishBookingOperation(db, {
        id: operationId,
        status: 'skipped',
        completedAt: now,
        result: { direction: 'delete', reason: 'no_external_event' },
      });
      return 'skipped';
    }
    try {
      await input.remove();
    } catch (error) {
      await finishBookingOperation(db, {
        id: operationId,
        status: 'retry_wait',
        completedAt: now,
        errorCode: error instanceof Error ? error.name : 'calendar_delete_failed',
        result: { direction: 'delete' },
      });
      console.error('Google Calendar delete (cancel) failed:', error);
      return 'retry_wait';
    }
    await finishBookingOperation(db, {
      id: operationId,
      status: 'succeeded',
      completedAt: now,
      result: { direction: 'delete' },
    });
    return 'succeeded';
  } catch (error) {
    console.error('Google Calendar delete operation failed:', error);
    return 'retry_wait';
  }
}

export async function removeBookingFromGoogle(
  db: D1Database,
  credentials: GoogleServiceAccountCredentials,
  bookingId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.external_event_id, b.external_calendar_id,
              gc.id, gc.auth_type, gc.access_token
         FROM bookings b
         LEFT JOIN google_calendar_connections gc
           ON gc.calendar_id = b.external_calendar_id
          AND gc.staff_id = b.staff_id
          AND gc.is_active = 1
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      external_event_id: string | null;
      external_calendar_id: string | null;
      id: string | null;
      auth_type: string | null;
      access_token: string | null;
    }>();
  if (!row?.external_event_id || !row.external_calendar_id || !row.id || !row.auth_type) return;
  const client = await clientForConnection({
    id: row.id,
    calendar_id: row.external_calendar_id,
    auth_type: row.auth_type,
    access_token: row.access_token,
  }, credentials);
  await client.deleteEvent(row.external_event_id);
}
