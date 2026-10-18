

// ============================================================
// Admin: event_slots CRUD
// ============================================================

export async function ownsEvent(
  db: D1Database,
  event_id: string,
  account_id: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(event_id, account_id, account_id)
    .first<{ id: string }>();
  return row != null;
}

export interface SlotInput {
  starts_at?: string;
  ends_at?: string;
  capacity?: number | null;
  is_active?: number;
  sort_order?: number;
  /** #1000: 一括追加の再送防止キー。同じイベント内で一意。 */
  client_key?: string | null;
}

export function validateSlotInput(s: SlotInput, isCreate: boolean): { ok: true } | { ok: false; code: string } {
  if (isCreate) {
    if (typeof s.starts_at !== 'string' || typeof s.ends_at !== 'string') {
      return { ok: false, code: 'invalid_slot_range' };
    }
    if (s.starts_at >= s.ends_at) return { ok: false, code: 'invalid_slot_range' };
  } else {
    if (s.starts_at != null && typeof s.starts_at !== 'string') return { ok: false, code: 'invalid_slot_range' };
    if (s.ends_at != null && typeof s.ends_at !== 'string') return { ok: false, code: 'invalid_slot_range' };
    if (s.starts_at != null && s.ends_at != null && s.starts_at >= s.ends_at) {
      return { ok: false, code: 'invalid_slot_range' };
    }
  }
  if (s.capacity != null && (!Number.isInteger(s.capacity) || (s.capacity as number) < 1)) {
    return { ok: false, code: 'invalid_capacity' };
  }
  if (s.is_active != null && s.is_active !== 0 && s.is_active !== 1) {
    return { ok: false, code: 'invalid_is_active' };
  }
  if (s.sort_order != null && !Number.isInteger(s.sort_order)) {
    return { ok: false, code: 'invalid_sort_order' };
  }
  if (
    s.client_key != null &&
    (typeof s.client_key !== 'string' || s.client_key.length === 0 || s.client_key.length > 200)
  ) {
    return { ok: false, code: 'invalid_client_key' };
  }
  return { ok: true };
}
