import { getLineAccountFoldersByAccountIds, getLineAccountListStats, getLineAccountTagsByAccountIds } from '@line-crm/db';

/** 同じ可視一覧を使う独立した読取を並行し、一覧の補足情報をそろえる。 */
export async function readLineAccountListMetadata(db: D1Database, tenantId: string, accountIds: string[]) {
  const [tagsByAccount, foldersByAccount, statsByAccount, legacyEmailRows] = await Promise.all([
    getLineAccountTagsByAccountIds(db, tenantId, accountIds),
    getLineAccountFoldersByAccountIds(db, tenantId, accountIds),
    getLineAccountListStats(db, accountIds),
    db.prepare("SELECT line_account_id FROM account_settings WHERE key = 'inbox_email_legacy_enabled' AND value = 'true'")
      .all<{ line_account_id: string }>(),
  ]);
  const visibleIds = new Set(accountIds);
  const emailInboxAccountIds = new Set(legacyEmailRows.results
    .map((row) => row.line_account_id)
    .filter((id) => visibleIds.has(id)));
  return { tagsByAccount, foldersByAccount, statsByAccount, emailInboxAccountIds };
}
