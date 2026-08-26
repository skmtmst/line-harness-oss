export interface DashboardPreferenceRow {
  staff_id: string;
  line_account_id: string;
  version: number;
  cards: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardDefaultPreferenceRow {
  line_account_id: string;
  version: number;
  cards: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function getDashboardPreference(
  db: D1Database,
  staffId: string,
  lineAccountId: string,
): Promise<DashboardPreferenceRow | null> {
  return db.prepare(
    `SELECT staff_id, line_account_id, version, cards, created_at, updated_at
       FROM dashboard_preferences
      WHERE staff_id = ? AND line_account_id = ?`,
  ).bind(staffId, lineAccountId).first<DashboardPreferenceRow>();
}

export async function getDashboardDefaultPreference(
  db: D1Database,
  lineAccountId: string,
): Promise<DashboardDefaultPreferenceRow | null> {
  return db.prepare(
    `SELECT line_account_id, version, cards, updated_by, created_at, updated_at
       FROM dashboard_default_preferences
      WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<DashboardDefaultPreferenceRow>();
}

export type DashboardPreferenceSaveResult =
  | { status: 'saved'; row: DashboardPreferenceRow }
  | { status: 'conflict'; current: DashboardPreferenceRow };

/** Compare-and-set prevents two open tabs from silently overwriting each other. */
export async function saveDashboardPreference(
  db: D1Database,
  input: { staffId: string; lineAccountId: string; expectedVersion: number; cards: unknown },
): Promise<DashboardPreferenceSaveResult> {
  const existing = await getDashboardPreference(db, input.staffId, input.lineAccountId);
  if ((existing?.version ?? 0) !== input.expectedVersion) {
    return { status: 'conflict', current: existing! };
  }

  const cards = JSON.stringify(input.cards);
  if (existing) {
    const updated = await db.prepare(
      `UPDATE dashboard_preferences
          SET cards = ?, version = version + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE staff_id = ? AND line_account_id = ? AND version = ?`,
    ).bind(cards, input.staffId, input.lineAccountId, input.expectedVersion).run();
    if ((updated.meta?.changes ?? 0) !== 1) {
      const current = await getDashboardPreference(db, input.staffId, input.lineAccountId);
      if (!current) throw new Error('dashboard preference disappeared during save');
      return { status: 'conflict', current };
    }
  } else {
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO dashboard_preferences (staff_id, line_account_id, version, cards)
       VALUES (?, ?, 1, ?)`,
    ).bind(input.staffId, input.lineAccountId, cards).run();
    if ((inserted.meta?.changes ?? 0) !== 1) {
      const current = await getDashboardPreference(db, input.staffId, input.lineAccountId);
      if (!current) throw new Error('dashboard preference insert was ignored without an existing row');
      return { status: 'conflict', current };
    }
  }

  const row = await getDashboardPreference(db, input.staffId, input.lineAccountId);
  if (!row) throw new Error('dashboard preference save did not produce a row');
  return { status: 'saved', row };
}

export async function deleteDashboardPreference(
  db: D1Database,
  staffId: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(
    'DELETE FROM dashboard_preferences WHERE staff_id = ? AND line_account_id = ?',
  ).bind(staffId, lineAccountId).run();
}

export async function saveDashboardDefaultPreference(
  db: D1Database,
  input: { lineAccountId: string; staffId: string; cards: unknown },
): Promise<DashboardDefaultPreferenceRow> {
  await db.prepare(
    `INSERT INTO dashboard_default_preferences (line_account_id, version, cards, updated_by)
     VALUES (?, 1, ?, ?)
     ON CONFLICT (line_account_id) DO UPDATE SET
       cards = excluded.cards,
       version = dashboard_default_preferences.version + 1,
       updated_by = excluded.updated_by,
       updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
  ).bind(input.lineAccountId, JSON.stringify(input.cards), input.staffId).run();
  const row = await getDashboardDefaultPreference(db, input.lineAccountId);
  if (!row) throw new Error('dashboard default preference save did not produce a row');
  return row;
}
