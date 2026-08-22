/**
 * 飲食店向け（テスト）の業務ロジック。
 *
 * 外部媒体へ書き戻す処理はここにも route にも置かない。検証版は
 * `inbound_only` を型と実行時の両方で固定し、誤って双方向化できないようにする。
 */

export const RESTAURANT_RESERVATION_SOURCES = [
  'restaurant_board',
  'reszaiko',
  'hotpepper',
  'tabelog',
  'gurunavi',
  'ikyu',
  'retty',
  'line',
  'phone',
  'manual',
] as const;

export type RestaurantReservationSource = (typeof RESTAURANT_RESERVATION_SOURCES)[number];

export type InboundReservation = {
  externalId: string;
  customerName: string;
  customerPhone?: string | null;
  lineUid?: string | null;
  guestCount: number;
  startsAt: string;
  endsAt: string;
  tableId?: string | null;
  courseId?: string | null;
  allergyNote?: string | null;
  note?: string | null;
  status?: 'pending' | 'confirmed' | 'seated' | 'visited' | 'cancelled' | 'no_show';
  sourceUpdatedAt?: string | null;
};

export type RestaurantTableCandidate = {
  id: string;
  minCapacity: number;
  maxCapacity: number;
  isActive: boolean;
};

export function isRestaurantReservationSource(value: unknown): value is RestaurantReservationSource {
  return typeof value === 'string' && (RESTAURANT_RESERVATION_SOURCES as readonly string[]).includes(value);
}

export function validateInboundReservation(value: unknown):
  | { ok: true; value: InboundReservation }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'reservation が必要です' };
  }
  const row = value as Record<string, unknown>;
  const externalId = typeof row.externalId === 'string' ? row.externalId.trim() : '';
  const customerName = typeof row.customerName === 'string' ? row.customerName.trim() : '';
  const guestCount = Number(row.guestCount);
  const startsAt = typeof row.startsAt === 'string' ? row.startsAt : '';
  const endsAt = typeof row.endsAt === 'string' ? row.endsAt : '';
  if (!externalId) return { ok: false, error: 'externalId が必要です' };
  if (!customerName) return { ok: false, error: 'customerName が必要です' };
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100) {
    return { ok: false, error: 'guestCount は1〜100の整数で指定してください' };
  }
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false, error: 'startsAt / endsAt の日時が正しくありません' };
  }
  const allowedStatuses = new Set(['pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show']);
  const status = typeof row.status === 'string' && allowedStatuses.has(row.status)
    ? row.status as InboundReservation['status']
    : 'confirmed';
  const optional = (key: string) => typeof row[key] === 'string' ? String(row[key]).trim() || null : null;
  return {
    ok: true,
    value: {
      externalId,
      customerName,
      customerPhone: optional('customerPhone'),
      lineUid: optional('lineUid'),
      guestCount,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      tableId: optional('tableId'),
      courseId: optional('courseId'),
      allergyNote: optional('allergyNote'),
      note: optional('note'),
      status,
      sourceUpdatedAt: optional('sourceUpdatedAt'),
    },
  };
}

/** 少人数で大卓を占有しないことを最優先に、収容差が小さい卓を返す。 */
export function chooseRestaurantTable(candidates: RestaurantTableCandidate[], guestCount: number): string | null {
  const suitable = candidates
    .filter((table) => table.isActive && table.minCapacity <= guestCount && table.maxCapacity >= guestCount)
    .sort((a, b) => {
      const waste = (a.maxCapacity - guestCount) - (b.maxCapacity - guestCount);
      if (waste !== 0) return waste;
      return a.maxCapacity - b.maxCapacity || a.id.localeCompare(b.id);
    });
  return suitable[0]?.id ?? null;
}

export function restaurantRoleFromAdminRole(role: 'owner' | 'admin' | 'staff' | 'viewer'):
  'super_admin' | 'store_manager' | 'staff' {
  if (role === 'owner') return 'super_admin';
  if (role === 'admin') return 'store_manager';
  return 'staff';
}
