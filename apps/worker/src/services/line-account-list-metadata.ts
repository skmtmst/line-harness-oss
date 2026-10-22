import { getLineAccountFoldersByAccountIds, getLineAccountListStats, getLineAccountTagsByAccountIds } from '@line-crm/db';

/** 同じ可視一覧を使う独立した読取を並行し、一覧の補足情報をそろえる。 */
export async function readLineAccountListMetadata(db: D1Database, tenantId: string, accountIds: string[]) {
  const [tagsByAccount, foldersByAccount, statsByAccount] = await Promise.all([
    getLineAccountTagsByAccountIds(db, tenantId, accountIds),
    getLineAccountFoldersByAccountIds(db, tenantId, accountIds),
    getLineAccountListStats(db, accountIds),
  ]);
  return { tagsByAccount, foldersByAccount, statsByAccount };
}
