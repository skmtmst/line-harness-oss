import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import {
  DEFAULT_TENANT_ID,
  activeTenantLineAccountSql,
  getBookingAdminSettings,
} from '@line-crm/db';
import type { RestaurantCustomerHoldInput, RestaurantCustomerConfirmInput } from '@line-crm/shared';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { dbFor } from '../services/db-router.js';
import { tzDateStr } from '../services/availability.js';
import { openSeatTables } from '../services/restaurant-closures.js';
import {
  customerAvailability,
  customerBooking,
  validCustomerDetails,
  customerDetailValue,
  processRestaurantCustomerNotices,
  type CustomerStore,
  type CustomerReservationRow,
} from '../services/restaurant-customer-booking.js';
import { reconcileRestaurantInventory } from '../services/restaurant-inventory-rules.js';
import { processBookingWaitlists } from '../services/waitlist-tick.js';
import { isAccountFeatureEnabled } from '@line-crm/db';
export const restaurantCustomerBooking = new Hono<Env>();
restaurantCustomerBooking.onError((e, c) =>
  /customer_table_conflict|customer_duplicate_booking|customer_line_capacity|restaurant_table_conflict|closure_conflict|UNIQUE constraint/.test(
    String(e),
  )
    ? c.json({ success: false, error: 'slot_conflict' }, 409)
    : c.json({ success: false, error: 'booking_failed' }, 500),
);
restaurantCustomerBooking.use('/api/liff/restaurant/*', async (c, next) => {
  if (!restaurantTestEnabled(c.env))
    return c.json({ success: false, error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  await next();
});
async function identity(
  c: Context<Env>,
): Promise<{ accountId: string; uid: string; friendName: string } | Response> {
  const liffId = c.req.query('liffId'),
    auth = c.req.header('Authorization');
  if (!liffId || !auth?.startsWith('Bearer ') || !auth.slice(7).trim())
    return c.json({ success: false, error: 'unauthorized' }, 401);
  const a = await dbFor(c.env)
    .prepare(
      `SELECT la.id,la.login_channel_id FROM line_accounts la WHERE la.liff_id=? AND la.is_active=1 AND la.archived_at IS NULL AND ${activeTenantLineAccountSql('la.id')}`,
    )
    .bind(liffId)
    .first<{ id: string; login_channel_id: string | null }>();
  if (!a?.login_channel_id)
    return c.json({ success: false, error: 'not_found' }, 404);
  if (!(await isAccountFeatureEnabled(c.env.DB, a.id, 'restaurant_test')))
    return c.json({ success: false, error: 'not_found' }, 404);
  let verified: { sub?: string; aud?: string; exp?: number };
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: auth.slice(7),
        client_id: a.login_channel_id,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) return c.json({ success: false, error: 'unauthorized' }, 401);
    verified = await r.json();
  } catch {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }
  if (
    !verified.sub ||
    verified.aud !== a.login_channel_id ||
    !verified.exp ||
    verified.exp <= Date.now() / 1000
  )
    return c.json({ success: false, error: 'unauthorized' }, 401);
  const friend = await dbFor(c.env)
    .prepare(
      'SELECT display_name,is_following FROM friends WHERE line_user_id=? AND line_account_id=?',
    )
    .bind(verified.sub, a.id)
    .first<{ display_name: string; is_following: number }>();
  if (!friend || !friend.is_following)
    return c.json({ success: false, error: 'cannot_book' }, 403);
  return {
    accountId: a.id,
    uid: verified.sub,
    friendName: friend.display_name || 'LINEのお客さま',
  };
}
async function storeFor(
  c: Context<Env>,
  accountId: string,
  storeId: unknown,
): Promise<CustomerStore | null> {
  if (typeof storeId !== 'string') return null;
  return dbFor(c.env, storeId)
    .prepare(
      `SELECT s.id,s.name,s.timezone,s.line_account_id,COALESCE(a.tenant_id,?) tenant_id FROM rt_stores s JOIN line_accounts a ON a.id=s.line_account_id WHERE s.id=? AND s.line_account_id=? AND s.status='active'`,
    )
    .bind(DEFAULT_TENANT_ID, storeId, accountId)
    .first<CustomerStore>();
}
async function finish(c: Context<Env>, store: CustomerStore) {
  // 保存を先に確定する。通知失敗で確定予約を二度作らない。媒体作業は既存の台帳に作る。
  try {
    await reconcileRestaurantInventory(c.env, store.id);
    await processBookingWaitlists(c.env, store.line_account_id);
    await processRestaurantCustomerNotices(c.env, store.id);
  } catch {
    console.error(
      JSON.stringify({ event: 'restaurant_customer_notice_pending' }),
    );
  }
}
restaurantCustomerBooking.get('/api/liff/restaurant/link/:token', async (c) => {
  const self = await identity(c);
  if (self instanceof Response) return self;
  const store = await dbFor(c.env)
    .prepare(
      `SELECT s.id,s.name,s.timezone FROM rt_reservation_links l JOIN rt_stores s ON s.id=l.store_id WHERE l.token=? AND s.line_account_id=? AND s.status='active'`,
    )
    .bind(c.req.param('token'), self.accountId)
    .first();
  return store
    ? c.json({ success: true, data: store })
    : c.json({ success: false, error: 'not_found' }, 404);
});
restaurantCustomerBooking.get(
  '/api/liff/restaurant/availability',
  async (c) => {
    const self = await identity(c);
    if (self instanceof Response) return self;
    const store = await storeFor(c, self.accountId, c.req.query('storeId'));
    if (!store) return c.json({ success: false, error: 'not_found' }, 404);
    const result = await customerAvailability(
      dbFor(c.env, store.id),
      store,
      c.req.query('date') ?? '',
      Number(c.req.query('guestCount')),
    );
    return result
      ? c.json({ success: true, data: result.data })
      : c.json(
          { success: false, error: 'invalid_date_or_unconfigured_hours' },
          400,
        );
  },
);
restaurantCustomerBooking.post('/api/liff/restaurant/holds', async (c) => {
  const self = await identity(c);
  if (self instanceof Response) return self;
  const body = await c.req
    .json<RestaurantCustomerHoldInput>()
    .catch(() => null);
  if (
    !body ||
    !validCustomerDetails(body) ||
    typeof body.startsAt !== 'string' ||
    !Number.isFinite(Date.parse(body.startsAt)) ||
    !Number.isInteger(body.guestCount) ||
    body.guestCount < 1 ||
    body.guestCount > 100 ||
    typeof body.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(body.requestId)
  )
    return c.json({ success: false, error: 'invalid_hold' }, 400);
  const store = await storeFor(c, self.accountId, body.storeId);
  if (!store) return c.json({ success: false, error: 'not_found' }, 404);
  const db = dbFor(c.env, store.id),
    startsAt = new Date(body.startsAt).toISOString();
  const old = await db
    .prepare(
      'SELECT *, (SELECT seat_type FROM rt_tables t WHERE t.id=rt_reservations.table_id AND t.store_id=rt_reservations.store_id) AS seat_type FROM rt_reservations WHERE store_id=? AND line_uid=? AND customer_request_id=?',
    )
    .bind(store.id, self.uid, body.requestId)
    .first<CustomerReservationRow>();
  if (old) {
    if (
      old.note !== customerDetailValue(body.note) ||
      old.customer_phone !== customerDetailValue(body.customerPhone) ||
      old.starts_at !== startsAt ||
      old.guest_count !== body.guestCount ||
      old.status === 'cancelled' ||
      (old.status === 'pending' &&
        Date.parse(old.hold_expires_at ?? '') <= Date.now())
    )
      return c.json({ success: false, error: 'request_conflict' }, 409);
    return c.json({ success: true, data: customerBooking(old) });
  }
  const result = await customerAvailability(
      db,
      store,
      tzDateStr(store.timezone, new Date(startsAt)),
      body.guestCount,
    ),
    slot = result?.data.slots.find(
      (s) => s.startsAt === startsAt && s.available,
    );
  if (!result || !slot)
    return c.json({ success: false, error: 'slot_conflict' }, 409);
  const tables = await openSeatTables(
      db,
      store.id,
      startsAt,
      slot.endsAt,
      body.guestCount,
    ),
    id = crypto.randomUUID();
  if (!tables.length)
    return c.json({ success: false, error: 'slot_conflict' }, 409);
  const expires = new Date(
    Math.min(Date.now() + result.holdMinutes * 60000, Date.parse(startsAt)),
  ).toISOString();
  // 営業時間を読んだ版と同じときだけ作る。席・本人・残枠はDBトリガーでも守る。
  await db
    .prepare(
      `INSERT INTO rt_reservations(id,store_id,source,external_id,customer_name,line_uid,guest_count,starts_at,ends_at,table_id,status,hold_expires_at,customer_request_id,note,customer_phone) SELECT ?,?,'line',?,?,?,?,?,?,?,'pending',?,?,?,? WHERE EXISTS(SELECT 1 FROM rt_opening_hours_settings WHERE store_id=? AND version=?)`,
    )
    .bind(
      id,
      store.id,
      `customer:${id}`,
      self.friendName,
      self.uid,
      body.guestCount,
      startsAt,
      slot.endsAt,
      tables[0]!.id,
      expires,
      body.requestId,
      customerDetailValue(body.note),
      customerDetailValue(body.customerPhone),
      store.id,
      result.hoursVersion,
    )
    .run();
  const saved = await db
    .prepare('SELECT *, (SELECT seat_type FROM rt_tables t WHERE t.id=rt_reservations.table_id AND t.store_id=rt_reservations.store_id) AS seat_type FROM rt_reservations WHERE id=?')
    .bind(id)
    .first<CustomerReservationRow>();
  if (!saved) return c.json({ success: false, error: 'slot_conflict' }, 409);
  return c.json({ success: true, data: customerBooking(saved) }, 201);
});
restaurantCustomerBooking.get(
  '/api/liff/restaurant/reservations',
  async (c) => {
    const self = await identity(c);
    if (self instanceof Response) return self;
    const store = await storeFor(c, self.accountId, c.req.query('storeId'));
    if (!store) return c.json({ success: false, error: 'not_found' }, 404);
    const rows = (
      await dbFor(c.env, store.id)
        .prepare(
          'SELECT *, (SELECT seat_type FROM rt_tables t WHERE t.id=rt_reservations.table_id AND t.store_id=rt_reservations.store_id) AS seat_type FROM rt_reservations WHERE store_id=? AND line_uid=? ORDER BY starts_at DESC LIMIT 100',
        )
        .bind(store.id, self.uid)
        .all<CustomerReservationRow>()
    ).results;
    return c.json({ success: true, data: rows.map(customerBooking) });
  },
);
for (const action of ['confirm', 'cancel', 'reschedule'] as const) {
  restaurantCustomerBooking.post(
    `/api/liff/restaurant/reservations/:id/${action}`,
    async (c) => {
      const self = await identity(c);
      if (self instanceof Response) return self;
      const b = await c.req
        .json<RestaurantCustomerConfirmInput & {startsAt?: string; guestCount?: number}>()
        .catch(() => null);
      if (
        !b ||
        !Number.isSafeInteger(b.expectedVersion) ||
        b.expectedVersion < 1
      )
        return c.json(
          { success: false, error: 'expected_version_required' },
          400,
        );
      if (action === 'confirm' && !validCustomerDetails(b)) return c.json({success:false,error:'invalid_customer_details'},400);
      const db = dbFor(c.env),
        row = await db
          .prepare(
            `SELECT r.*, (SELECT seat_type FROM rt_tables t WHERE t.id=r.table_id AND t.store_id=r.store_id) AS seat_type FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id WHERE r.id=? AND r.line_uid=? AND s.line_account_id=? AND s.status='active' AND r.customer_request_id IS NOT NULL`,
          )
          .bind(c.req.param('id'), self.uid, self.accountId)
          .first<CustomerReservationRow>();
      if (!row) return c.json({ success: false, error: 'not_found' }, 404);
      const store = (await storeFor(c, self.accountId, row.store_id))!;
      if (
        (action === 'confirm' && row.status === 'confirmed') ||
        (action === 'cancel' && row.status === 'cancelled')
      ) {
        if (action === 'confirm' && ((b.note !== undefined && customerDetailValue(b.note)!==row.note) || (b.customerPhone !== undefined && customerDetailValue(b.customerPhone)!==row.customer_phone))) return c.json({success:false,error:'request_conflict'},409);
        await finish(c, store);
        return c.json({ success: true, data: customerBooking(row) });
      }
      if (row.customer_version !== b.expectedVersion)
        return c.json({ success: false, error: 'version_conflict' }, 409);
      if (
        action === 'confirm' &&
        (row.status !== 'pending' ||
          !row.hold_expires_at ||
          Date.parse(row.hold_expires_at) <= Date.now())
      )
        return c.json({ success: false, error: 'hold_expired' }, 409);
      if (
        action !== 'confirm' &&
        !['pending', 'confirmed'].includes(row.status)
      )
        return c.json({ success: false, error: 'state_conflict' }, 409);
      const settings = await getBookingAdminSettings(db, self.accountId);
      if (!settings) return c.json({ success: false, error: 'not_found' }, 404);
      if (
        action !== 'confirm' &&
        Date.now() >=
          Date.parse(row.starts_at) -
            settings.cancelDeadlineMinutesBefore * 60000
      )
        return c.json({ success: false, error: 'self_deadline_passed' }, 403);
      let starts = row.starts_at,
        ends = row.ends_at,
        table = row.table_id,
        seatType = row.seat_type,
        count = row.guest_count,
        hoursVersion: number | null = null;
      if (action === 'reschedule') {
        if (
          row.status !== 'confirmed' ||
          typeof b.startsAt !== 'string' ||
          !Number.isFinite(Date.parse(b.startsAt)) ||
          !Number.isInteger(b.guestCount) ||
          !b.guestCount ||
          b.guestCount < 1 ||
          b.guestCount > 100
        )
          return c.json({ success: false, error: 'invalid_change' }, 400);
        starts = new Date(b.startsAt).toISOString();
        count = b.guestCount;
        const available = await customerAvailability(
            db,
            store,
            tzDateStr(store.timezone, new Date(starts)),
            count,
            row.id,
          ),
          slot = available?.data.slots.find(
            (s) => s.startsAt === starts && s.available,
          );
        if (!slot || !available)
          return c.json({ success: false, error: 'slot_conflict' }, 409);
        ends = slot.endsAt;
        hoursVersion = available.hoursVersion;
        // 候補を上の検査と同じく、自分の古い予約だけ除外して絞る。
        const candidates = await openSeatTables(
          db,
          store.id,
          starts,
          ends,
          count,
          true,
        );
        table = null;
        for (const t of candidates) {
          if (
            !(await db
              .prepare(
                `SELECT 1 FROM rt_reservations WHERE store_id=? AND id<>? AND table_id=? AND status NOT IN ('cancelled','no_show') AND (status<>'pending' OR hold_expires_at IS NULL OR julianday(hold_expires_at)>julianday('now')) AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?) UNION ALL SELECT 1 FROM rt_seat_waitlist WHERE store_id=? AND table_id=? AND status='invited' AND julianday(hold_expires_at)>julianday('now') AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?)`,
              )
              .bind(
                store.id,
                row.id,
                t.id,
                ends,
                starts,
                store.id,
                t.id,
                ends,
                starts,
              )
              .first())
          ) {
            table = t.id;
            seatType = t.seatType ?? null;
            break;
          }
        }
        if (!table)
          return c.json({ success: false, error: 'slot_conflict' }, 409);
      }
      const next = {
        ...row,
        note: action === 'confirm' && b.note !== undefined ? customerDetailValue(b.note) : row.note,
        customer_phone: action === 'confirm' && b.customerPhone !== undefined ? customerDetailValue(b.customerPhone) : row.customer_phone,
        status: action === 'cancel' ? 'cancelled' : 'confirmed',
        starts_at: starts,
        ends_at: ends,
        table_id: table,
        seat_type: seatType,
        guest_count: count,
        customer_version: row.customer_version + 1,
        hold_expires_at: null,
      };
      const results = await db.batch([
        db
          .prepare(
            `UPDATE rt_reservations SET status=?,starts_at=?,ends_at=?,table_id=?,guest_count=?,note=?,customer_phone=?,customer_version=customer_version+1,hold_expires_at=NULL,updated_at=datetime('now') WHERE id=? AND line_uid=? AND customer_version=? AND status=? AND (? IS NULL OR EXISTS(SELECT 1 FROM rt_opening_hours_settings WHERE store_id=? AND version=?)) AND (?<>'confirm' OR julianday(hold_expires_at)>julianday('now'))`,
          )
          .bind(
            next.status,
            starts,
            ends,
            table,
            count,
            next.note,
            next.customer_phone,
            row.id,
            self.uid,
            b.expectedVersion,
            row.status,
            hoursVersion,
            store.id,
            hoursVersion,
            action,
          ),
        // UPDATEが0件なら別の版への通知は作らない。
        db
          .prepare(
            `INSERT OR IGNORE INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) SELECT ?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            `restaurant-customer:${row.id}:${next.customer_version}`,
            store.id,
            row.id,
            next.customer_version,
            self.uid,
            action === 'cancel'
              ? `${store.name}の予約を取り消しました。`
              : `${store.name}の予約を${action === 'confirm' ? '確定' : '変更'}しました。\n${new Intl.DateTimeFormat('ja-JP', { timeZone: store.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(starts))}\n${count}名\n変更・取り消しはLINEの予約ページから行えます。`,
            crypto.randomUUID(),
          ),
      ]);
      if (!results[0]!.meta.changes)
        return c.json({ success: false, error: 'version_conflict' }, 409);
      await finish(c, store);
      return c.json({ success: true, data: customerBooking(next) });
    },
  );
}
