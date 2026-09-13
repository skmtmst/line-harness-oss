import { listBookingOperations } from './booking-operation-runs.js';

interface BookingDetailRow {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  booking_customer_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  price_at_booking: number;
  requested_at: string;
  decided_at: string | null;
  source: string;
  created_by_staff_id: string | null;
  external_event_id: string | null;
  menu_name: string;
  staff_name: string;
  customer_name: string;
  customer_phone_last4: string | null;
  customer_pet_name: string | null;
  is_line_linked: number;
}

interface HistoryRow {
  id: string;
  starts_at: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  price_at_booking: number;
  menu_name: string;
  staff_name: string;
}

function scalarText(row: { value?: string | null; value_text?: string | null } | null): string | null {
  return row?.value_text ?? row?.value ?? null;
}

async function friendProfile(db: D1Database, friendId: string | null) {
  if (!friendId) return { phone: null, petName: null, tags: [] as Array<{ id: string; name: string }>, mileageBalance: null };
  const [fields, tags, mileage] = await Promise.all([
    db.prepare(
      `SELECT ff.field_key, ffv.value, ffv.value_text
         FROM friend_field_values ffv
         JOIN friend_fields ff ON ff.id = ffv.field_id
        WHERE ffv.friend_id = ?
          AND ff.field_key IN ('phone', 'phone_number', 'tel', 'pet_name')
        ORDER BY ff.display_order ASC`,
    ).bind(friendId).all<{ field_key: string; value: string | null; value_text: string | null }>(),
    db.prepare(
      `SELECT t.id, t.name
         FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE ft.friend_id = ? ORDER BY t.name ASC LIMIT 20`,
    ).bind(friendId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT COALESCE(SUM(ml.amount), 0) AS balance
         FROM mileage_ledger ml
         JOIN mileage_programs mp ON mp.id = ml.program_id
        WHERE ml.beneficiary_friend_id = ? AND ml.status = 'available'`,
    ).bind(friendId).first<{ balance: number }>(),
  ]);
  const values = fields.results ?? [];
  const phone = values.find((row) => ['phone', 'phone_number', 'tel'].includes(row.field_key));
  const pet = values.find((row) => row.field_key === 'pet_name');
  return {
    phone: scalarText(phone ?? null),
    petName: scalarText(pet ?? null),
    tags: tags.results ?? [],
    mileageBalance: mileage ? Number(mileage.balance) : null,
  };
}

async function historyForCustomer(
  db: D1Database,
  input: { lineAccountId: string; friendId: string | null; bookingCustomerId: string | null; excludeId?: string },
): Promise<HistoryRow[]> {
  if (!input.friendId && !input.bookingCustomerId) return [];
  const rows = await db.prepare(
    `SELECT b.id, b.starts_at, b.status, b.customer_note, b.internal_note,
            b.price_at_booking, m.name AS menu_name, s.display_name AS staff_name
       FROM bookings b
       JOIN menus m ON m.id = b.menu_id
       JOIN staff s ON s.id = b.staff_id
      WHERE b.line_account_id = ?
        AND ((? IS NOT NULL AND b.friend_id = ?)
          OR (? IS NOT NULL AND b.booking_customer_id = ?))
        AND (? IS NULL OR b.id <> ?)
      ORDER BY b.starts_at DESC LIMIT 10`,
  ).bind(
    input.lineAccountId,
    input.friendId, input.friendId,
    input.bookingCustomerId, input.bookingCustomerId,
    input.excludeId ?? null, input.excludeId ?? null,
  ).all<HistoryRow>();
  return rows.results ?? [];
}

function mapHistory(row: HistoryRow) {
  return {
    id: row.id,
    startsAt: row.starts_at,
    status: row.status,
    customerNote: row.customer_note,
    handoverNote: row.internal_note,
    price: Number(row.price_at_booking),
    menuName: row.menu_name,
    staffName: row.staff_name,
  };
}

export async function getBookingCustomerContext(
  db: D1Database,
  input: { lineAccountId: string; friendId?: string | null; bookingCustomerId?: string | null },
) {
  const friendId = input.friendId ?? null;
  const bookingCustomerId = input.bookingCustomerId ?? null;
  const identity = friendId
    ? await db.prepare(
      `SELECT id, display_name FROM friends WHERE id = ? AND line_account_id = ?`,
    ).bind(friendId, input.lineAccountId).first<{ id: string; display_name: string | null }>()
    : await db.prepare(
      `SELECT id, display_name, phone_last4, pet_name, friend_id
         FROM booking_customers WHERE id = ? AND line_account_id = ?`,
    ).bind(bookingCustomerId, input.lineAccountId).first<{
      id: string; display_name: string; phone_last4: string; pet_name: string | null; friend_id: string | null;
    }>();
  if (!identity) return null;
  const linkedFriendId = 'friend_id' in identity && typeof identity.friend_id === 'string'
    ? identity.friend_id
    : null;
  const resolvedFriendId: string | null = friendId ?? linkedFriendId;
  const [profile, history] = await Promise.all([
    friendProfile(db, resolvedFriendId),
    historyForCustomer(db, { lineAccountId: input.lineAccountId, friendId: resolvedFriendId, bookingCustomerId }),
  ]);
  const previousHandover = history.find((row) => row.internal_note?.trim())?.internal_note ?? null;
  return {
    id: identity.id,
    friendId: resolvedFriendId,
    displayName: identity.display_name ?? '名前未設定',
    isLineLinked: Boolean(resolvedFriendId),
    phone: 'phone_last4' in identity ? `末尾 ${identity.phone_last4}` : profile.phone,
    petName: 'pet_name' in identity ? identity.pet_name : profile.petName,
    tags: profile.tags,
    mileageBalance: profile.mileageBalance,
    previousHandover,
    recentBookings: history.map(mapHistory),
  };
}

export async function getBookingAdminDetail(
  db: D1Database,
  input: { id: string; lineAccountId: string },
) {
  const row = await db.prepare(
    `SELECT b.id, b.line_account_id, b.friend_id, b.booking_customer_id,
            b.starts_at, b.ends_at, b.status, b.customer_note, b.internal_note,
            b.price_at_booking, b.requested_at, b.decided_at, b.source,
            b.created_by_staff_id, b.external_event_id,
            m.name AS menu_name, s.display_name AS staff_name,
            COALESCE(f.display_name, bc.display_name, '名前未設定') AS customer_name,
            bc.phone_last4 AS customer_phone_last4,
            bc.pet_name AS customer_pet_name,
            CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS is_line_linked
       FROM bookings b
       JOIN menus m ON m.id = b.menu_id
       JOIN staff s ON s.id = b.staff_id
       LEFT JOIN friends f ON f.id = b.friend_id
       LEFT JOIN booking_customers bc ON bc.id = b.booking_customer_id
      WHERE b.id = ? AND b.line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<BookingDetailRow>();
  if (!row) return null;
  const [profile, history, reminders, operations] = await Promise.all([
    friendProfile(db, row.friend_id),
    historyForCustomer(db, {
      lineAccountId: input.lineAccountId,
      friendId: row.friend_id,
      bookingCustomerId: row.booking_customer_id,
      excludeId: row.id,
    }),
    db.prepare(
      `SELECT id, kind, scheduled_at, sent_at, status, retry_count
         FROM booking_reminders WHERE booking_id = ? ORDER BY scheduled_at ASC`,
    ).bind(row.id).all<{
      id: string; kind: string; scheduled_at: string; sent_at: string | null; status: string; retry_count: number;
    }>(),
    listBookingOperations(db, { bookingId: row.id, lineAccountId: input.lineAccountId }),
  ]);
  const previousHandover = history.find((item) => item.internal_note?.trim())?.internal_note ?? null;
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    customerNote: row.customer_note,
    internalNote: row.internal_note,
    price: Number(row.price_at_booking),
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    source: row.source,
    createdByStaffId: row.created_by_staff_id,
    calendarSync: row.external_event_id ? 'synced' : 'not_configured',
    menuName: row.menu_name,
    staffName: row.staff_name,
    customer: {
      friendId: row.friend_id,
      bookingCustomerId: row.booking_customer_id,
      displayName: row.customer_name,
      isLineLinked: row.is_line_linked === 1,
      phone: row.customer_phone_last4 ? `末尾 ${row.customer_phone_last4}` : profile.phone,
      petName: row.customer_pet_name ?? profile.petName,
      tags: profile.tags,
      mileageBalance: profile.mileageBalance,
    },
    previousHandover,
    history: history.map(mapHistory),
    reminders: (reminders.results ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      scheduledAt: item.scheduled_at,
      sentAt: item.sent_at,
      status: item.status,
      retryCount: Number(item.retry_count),
    })),
    operations,
  };
}
