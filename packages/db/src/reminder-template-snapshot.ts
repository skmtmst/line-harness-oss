import { sqlIdSet } from './id-queries.js';


/**
 * R346: 登録時に使っていたテンプレートの公開版を写す。
 * {"テンプレートID": 公開版番号} の JSON。本文は作らない。
 * まだ公開されていない・消えたテンプレートは載せず、送るときに今の版を読む。
 */
export async function snapshotReminderTemplateVersions(
  db: D1Database,
  templateIds: Array<string | null>,
): Promise<string | null> {
  const ids = [...new Set(templateIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return null;
  const rows = await db.prepare(
    `SELECT id, published_version FROM templates WHERE id IN (${sqlIdSet(ids).sql})`,
  ).bind(...sqlIdSet(ids).binds).all<{ id: string; published_version: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results ?? []) {
    const version = Number(row.published_version);
    if (Number.isFinite(version) && version > 0) map[row.id] = version;
  }
  return Object.keys(map).length > 0 ? JSON.stringify(map) : null;
}


/**
 * R346: 登録に残した版指定を読む。壊れた記録は「指定なし」と同じにする。
 */
export function parseTemplateVersionSnapshot(
  value: string | null | undefined,
): Record<string, number> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map: Record<string, number> = {};
    for (const [key, version] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(version);
      if (key && Number.isFinite(n) && n > 0) map[key] = n;
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch {
    return null;
  }
}
