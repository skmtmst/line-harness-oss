


/**
 * r2_key から同一アカウントのメディアIDを引く。
 * ウェビナー動画のように「保存値が r2_key のまま残る」使用先が、
 * 現在どのメディアを指しているかを戻り値へ載せるために使う。
 */
export async function getMediaIdByR2Key(
  db: D1Database,
  r2Key: string,
  lineAccountId: string | null,
): Promise<string | null> {
  const row = lineAccountId === null
    ? await db.prepare(`SELECT id FROM media WHERE r2_key = ? AND line_account_id IS NULL`)
        .bind(r2Key).first<{ id: string }>()
    : await db.prepare(`SELECT id FROM media WHERE r2_key = ? AND line_account_id = ?`)
        .bind(r2Key, lineAccountId).first<{ id: string }>();
  return row?.id ?? null;
}


/** メディアの全版のr2_key（現行・旧版を問わず、固定参照が指し得る実体）。 */
export async function getMediaVersionKeys(
  db: D1Database,
  mediaId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT r2_key FROM media_versions WHERE media_id = ?`)
    .bind(mediaId)
    .all<{ r2_key: string }>();
  return rows.results.map((row) => row.r2_key);
}
