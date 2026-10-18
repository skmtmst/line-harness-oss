import type { IndustryStyle, StyleBooking } from '@line-crm/shared';
import { eligible, instant, civilDate } from './style-analytics-core.js';
import { personMetrics } from './style-person-metrics.js';

/** Uses only account-scoped rows already filtered by staff/store/menu permissions. */
export async function styleDashboardSidebar(
  db: D1Database,
  account: string,
  style: IndustryStyle,
  rows: StyleBooking[],
  timeZone: string,
  now: number,
  settings: Record<string, number>,
  staffId?: string,
  storeId?: string,
) {
  const today = civilDate(now, timeZone);
  const todayRows = rows.filter(
    (r) =>
      eligible(r) &&
      r.status !== 'no_show' &&
      civilDate(instant(r.startsAt), timeZone) === today,
  );
  const attention = [];
  if (style === 'restaurant') {
    for (const r of todayRows.filter((r) => r.kind === 'restaurant')) {
      const detail = await db
        .prepare(
          `SELECT allergy_note allergy FROM rt_reservations WHERE id=? AND store_id IN(SELECT id FROM rt_stores WHERE line_account_id=?)`,
        )
        .bind(r.id, account)
        .first<{ allergy: string | null }>();
      const fields = r.friendId
        ? (
            await db
              .prepare(
                `SELECT k.fixed_key,COALESCE(v.value,v.value_text,v.value_date) value FROM friend_field_values v JOIN friend_fixed_fields k ON k.field_id=v.field_id JOIN friends f ON f.id=v.friend_id WHERE f.line_account_id=? AND f.id=? AND k.fixed_key IN('allergy','anniversary')`,
              )
              .bind(account, r.friendId)
              .all<{ fixed_key: string; value: string | null }>()
          ).results
        : [];
      const allergy =
        detail?.allergy ||
        fields.find((f) => f.fixed_key === 'allergy')?.value ||
        null;
      const anniversary = fields.find(
        (f) => f.fixed_key === 'anniversary',
      )?.value;
      const noShowHistory = rows.some(
        (p) =>
          p.personKey === r.personKey &&
          p.status === 'no_show' &&
          instant(p.startsAt) < instant(r.startsAt),
      );
      const isAnniversary =
        !!anniversary && anniversary.slice(5, 10) === today.slice(5);
      if (allergy || isAnniversary || noShowHistory)
        attention.push({
          id: r.id,
          name: r.name,
          friendId: r.friendId,
          startsAt: r.startsAt,
          allergy,
          anniversary: isAnniversary,
          noShowHistory,
        });
    }
  }
  // Waitlist has no assigned staff: omit it under a staff filter instead of leaking other staff's work.
  const waitlist =
    style === 'restaurant' && !staffId
      ? (
          await db
            .prepare(
              `SELECT w.id,w.customer_name name,w.starts_at startsAt,w.guest_count partySize,w.status,w.store_id storeId FROM rt_seat_waitlist w JOIN rt_stores s ON s.id=w.store_id WHERE s.line_account_id=? AND (? IS NULL OR s.id=?) AND w.status IN('waiting','invited') ORDER BY w.starts_at,w.created_at,w.id`,
            )
            .bind(account, storeId ?? null, storeId ?? null)
            .all<{
              id: string;
              name: string;
              startsAt: string;
              partySize: number;
              status: string;
              storeId: string;
            }>()
        ).results.filter(
          (w) => civilDate(instant(w.startsAt), timeZone) === today,
        )
      : [];
  const noNextBooking =
    style === 'salon'
      ? personMetrics(
          rows,
          now - 30 * 86400000,
          now,
          now,
          settings,
        ).people.filter((p) => !p.nextBooking)
      : [];
  return { today, attention, waitlist, noNextBooking };
}
