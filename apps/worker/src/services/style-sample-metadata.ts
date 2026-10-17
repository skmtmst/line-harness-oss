/** IDs come from an already authorized resource response; never use this as an access check. */
export async function withStyleSampleMetadata<T extends { id: string }>(
  db: D1Database,
  items: T[],
  kind: string,
): Promise<Array<T & import('@line-crm/shared').StyleSampleMetadata>> {
  if (!items.length) return [];
  const metadata = new Map<
    string,
    {
      target_id: string;
      is_sample: number;
      item_key: string;
      set_id: string | null;
      set_version: number;
    }
  >();
  for (let start = 0; start < items.length; start += 80) {
    const ids = items.slice(start, start + 80).map((i) => i.id);
    const rows = await db
      .prepare(
        `SELECT target_id,is_sample,item_key,set_id,set_version FROM style_starter_items WHERE kind=? AND target_id IN(${ids.map(() => '?').join(',')}) ORDER BY applied_at`,
      )
      .bind(kind, ...ids)
      .all<{
        target_id: string;
        is_sample: number;
        item_key: string;
        set_id: string | null;
        set_version: number;
      }>();
    for (const row of rows.results ?? [])
      if (!metadata.has(row.target_id)) metadata.set(row.target_id, row);
  }
  return items.map((i) => {
    const m = metadata.get(i.id);
    return {
      ...i,
      isSample: !!m?.is_sample,
      sampleKey: m?.item_key ?? null,
      starterSetId: m?.set_id ?? null,
      starterSetVersion: m?.set_version ?? null,
    };
  });
}
