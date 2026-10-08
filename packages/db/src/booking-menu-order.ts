import type { BookingMenuOrderChange } from '@line-crm/shared';

/** One UPDATE, with a materialized revision check, prevents partial CAS success. */
export async function reorderBookingMenus(db: D1Database, accountId: string, changes: BookingMenuOrderChange[], staffId: string | null) {
  const payload = JSON.stringify(changes);
  const result = await db.batch([
    db.prepare(`WITH requested AS MATERIALIZED (
      SELECT json_extract(value, '$.id') id, json_extract(value, '$.expectedVersion') revision,
        json_extract(value, '$.sortOrder') position FROM json_each(?1)
    ), valid AS MATERIALIZED (
      SELECT m.id FROM menus m JOIN requested r ON r.id = m.id
      WHERE m.line_account_id = ?2 AND m.deleted_at IS NULL AND m.version = r.revision
    ) UPDATE menus SET sort_order = (SELECT position FROM requested WHERE id = menus.id),
      version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE id IN (SELECT id FROM valid) AND (SELECT COUNT(*) FROM valid) = json_array_length(?1)`)
      .bind(payload, accountId),
    db.prepare(`INSERT INTO menu_versions
      (id, menu_id, version_number, name, category_label, description, duration_minutes,
       buffer_after_minutes, base_price, price_mode, sort_order, is_active, rules_json, created_by_staff_id, created_at)
      SELECT lower(hex(randomblob(16))), m.id, m.version, m.name, m.category_label, m.description,
        m.duration_minutes, m.buffer_after_minutes, m.base_price, m.price_mode, m.sort_order, m.is_active,
        json_object('booking_window_days', m.booking_window_days, 'cutoff_hours_before', m.cutoff_hours_before,
          'cancel_deadline_hours_before', m.cancel_deadline_hours_before, 'intake_question', m.intake_question,
          'concurrent_capacity', m.concurrent_capacity), ?3, m.updated_at
      FROM menus m JOIN json_each(?1) r ON m.id = json_extract(r.value, '$.id')
      WHERE m.line_account_id = ?2 AND changes() = json_array_length(?1)`)
      .bind(payload, accountId, staffId),
  ]);
  return Number(result[0].meta.changes) === changes.length;
}
