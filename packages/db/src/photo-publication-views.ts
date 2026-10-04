/** 日別累計は逆順・同じ日・再送を最大値で吸収する。 */
export async function savePublicationDailyViews(db: D1Database, input: {
  publicationId: string; lineAccountId: string; viewDate: string;
  placementLabel: string; viewCount: number; now: string;
}): Promise<void> {
  await db.prepare(`INSERT INTO nen_photo_publication_daily_views
    (publication_id,line_account_id,view_date,placement_label,view_count,updated_at)
    SELECT id,line_account_id,?,?,?,? FROM nen_photo_publications WHERE id = ? AND line_account_id = ?
    ON CONFLICT(publication_id,view_date,placement_label) DO UPDATE SET
      view_count = MAX(nen_photo_publication_daily_views.view_count,excluded.view_count),
      updated_at = excluded.updated_at`)
    .bind(input.viewDate,input.placementLabel,input.viewCount,input.now,input.publicationId,input.lineAccountId).run();
}
/** UTCの今日を含む30日。日付なしの生涯累計は使わない。 */
export async function getPublicationThirtyDayViews(db: D1Database,lineAccountId:string,now=new Date()) {
  const end=now.toISOString().slice(0,10);
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-29)).toISOString().slice(0,10);
  const rows=await db.prepare(`WITH day_totals AS (
    SELECT publication_id,view_date,
      COALESCE(MAX(CASE WHEN placement_label = '' THEN view_count END),SUM(view_count)) AS amount
    FROM nen_photo_publication_daily_views WHERE line_account_id = ? AND view_date <= ?
    GROUP BY publication_id,view_date)
    SELECT publication_id,SUM(CASE WHEN view_date >= ? THEN amount ELSE 0 END) AS view_count
    FROM day_totals GROUP BY publication_id`).bind(lineAccountId,end,start).all<{publication_id:string;view_count:number}>();
  return new Map(rows.results.map(r=>[r.publication_id,Number(r.view_count)]));
}
