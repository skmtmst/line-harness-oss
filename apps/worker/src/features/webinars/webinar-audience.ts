export const WEBINAR_AUDIENCE_WINDOW_SECONDS = 60;

/** 再生の正常な記録だけを数える。入場しただけの人や異常な通信は人数に足さない。 */
export async function countRecentWebinarViewers(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
  nowEpoch: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT friend_id) AS count
      FROM webinar_view_segments
     WHERE webinar_id = ? AND session_start_at = ?
       AND julianday(received_at) >= julianday(?)
       AND julianday(received_at) <= julianday(?)
  `).bind(webinarId, sessionStartAt,
    new Date((nowEpoch - WEBINAR_AUDIENCE_WINDOW_SECONDS) * 1000).toISOString(),
    new Date(nowEpoch * 1000).toISOString()).first<{ count: number }>();
  return row?.count ?? 0;
}
