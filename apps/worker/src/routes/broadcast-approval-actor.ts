

export async function staffName(db: D1Database, staffId: string | null): Promise<string> {
  if (!staffId) return '担当者';
  try {
    const row = await db.prepare(`SELECT name FROM staff_members WHERE id = ?`)
      .bind(staffId).first<{ name: string }>();
    return row?.name?.trim() || '担当者';
  } catch {
    return '担当者';
  }
}
