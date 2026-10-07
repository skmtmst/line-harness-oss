import { jstNow } from './utils.js';
import { MileageRewardError } from './mileage-rewards.js';

export interface MileageRewardFolder {
  id: string;
  name: string;
  displayOrder: number;
  count: number;
}

export async function listMileageRewardFolders(db: D1Database, accountId: string): Promise<MileageRewardFolder[]> {
  const result = await db.prepare(`SELECT f.id, f.name, f.display_order AS displayOrder,
    (SELECT COUNT(*) FROM mileage_rewards r WHERE r.folder_id = f.id AND r.line_account_id = f.line_account_id AND r.status <> 'archived') AS count
    FROM mileage_reward_folders f WHERE f.line_account_id = ? ORDER BY f.display_order, f.id`)
    .bind(accountId).all<MileageRewardFolder>();
  return result.results;
}

export async function createMileageRewardFolder(db: D1Database, accountId: string, name: string): Promise<MileageRewardFolder> {
  if (!name.trim() || name.trim().length > 100) throw new MileageRewardError('invalid_folder_name', 'フォルダ名は1〜100字で入力してください', 422);
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO mileage_reward_folders (id, line_account_id, name, display_order, created_at, updated_at)
    SELECT ?, ?, ?, COALESCE(MAX(display_order), -1) + 1, ?, ? FROM mileage_reward_folders WHERE line_account_id = ?`)
    .bind(id, accountId, name.trim(), now, now, accountId).run();
  return (await listMileageRewardFolders(db, accountId)).find((folder) => folder.id === id)!;
}

export async function reorderMileageRewardFolders(db: D1Database, accountId: string, ids: string[]): Promise<void> {
  const current = await listMileageRewardFolders(db, accountId);
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length !== current.length || ids.some((id) => !current.some((folder) => folder.id === id))) {
    throw new MileageRewardError('invalid_folder_order', 'このアカウントの全フォルダを重複なく指定してください', 422);
  }
  if (ids.length) await db.batch(ids.map((id, index) => db.prepare('UPDATE mileage_reward_folders SET display_order = ?, updated_at = ? WHERE id = ? AND line_account_id = ?')
    .bind(index, jstNow(), id, accountId)));
}

export async function moveMileageRewardToFolder(db: D1Database, accountId: string, id: string, folderId: string | null): Promise<void> {
  const changed = await db.prepare(`UPDATE mileage_rewards SET folder_id = ?, updated_at = ? WHERE id = ? AND line_account_id = ?
    AND (? IS NULL OR EXISTS (SELECT 1 FROM mileage_reward_folders WHERE id = ? AND line_account_id = ?))`)
    .bind(folderId, jstNow(), id, accountId, folderId, folderId, accountId).run();
  if (!changed.meta?.changes) throw new MileageRewardError('folder_or_reward_not_found', '使い道かフォルダが見つかりません', 404);
}
