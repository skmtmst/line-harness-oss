/** Null capacity means unlimited. Legacy classes keep their one shared capacity. */
export async function eventModeRemaining(
  db: D1Database,
  slotId: string,
  mode: 'classroom' | 'online',
) {
  const s = await db
    .prepare(
      'SELECT capacity,classroom_capacity,online_capacity FROM event_slots WHERE id=?',
    )
    .bind(slotId)
    .first<{
      capacity: number | null;
      classroom_capacity: number | null;
      online_capacity: number | null;
    }>();
  if (!s) return 0;
  const split = s.classroom_capacity !== null || s.online_capacity !== null;
  const cap = split
    ? mode === 'classroom'
      ? s.classroom_capacity
      : s.online_capacity
    : s.capacity;
  if (cap === null) return null;
  const used = await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(party_size) FROM event_bookings WHERE slot_id=? AND status IN('requested','confirmed') AND (?=0 OR participation_mode=?)),0)+COALESCE((SELECT SUM(party_size) FROM event_waitlist WHERE slot_id=? AND status IN('offered','accepted') AND (?=0 OR participation_mode=?)),0) count`,
    )
    .bind(slotId, Number(split), mode, slotId, Number(split), mode)
    .first<{ count: number }>();
  return Math.max(0, cap - (used?.count ?? 0));
}
