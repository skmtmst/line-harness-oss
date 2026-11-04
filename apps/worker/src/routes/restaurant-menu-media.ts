/** メニュー画像はその店舗の登録メディアから選ぶ。 */
export async function validRestaurantMenuImage(db: D1Database, storeId: string, mediaId: string | null): Promise<boolean> {
  if (mediaId === null) return true;
  const row = await db.prepare(`SELECT m.id FROM media m JOIN rt_stores s ON s.line_account_id = m.line_account_id
    WHERE s.id = ? AND m.id = ? AND m.kind = 'image' AND m.archived_at IS NULL`)
    .bind(storeId, mediaId).first();
  return Boolean(row);
}

export function validRestaurantMenuDescription(value: unknown): value is string | null | undefined {
  return value == null || typeof value === 'string' && value.length <= 2000;
}

/** Match the store's account before exposing the deletion state. */
export async function restaurantMenuImageDeleting(db: D1Database, storeId: string, mediaId: string | null | undefined): Promise<boolean> {
  if (!mediaId) return false;
  return Boolean(await db.prepare(`SELECT 1 FROM media_deletion_jobs j JOIN rt_stores s ON s.line_account_id=j.line_account_id
    WHERE s.id=? AND j.media_id=?`).bind(storeId, mediaId).first());
}
