/** F-13: 省略は維持、nullは未分類。別の種類・アカウントの分類先は使わない。 */
export class FolderAssignmentError extends Error {
  readonly code = 'folder_invalid';
  constructor() { super('分類先が見つかりません。種類とLINEアカウントを確認してください'); }
}

export async function readFolderAssignment(
  db: D1Database, kind: 'automation' | 'common_action' | 'webhook' | 'conversion',
  accountId: string | null, value: unknown,
): Promise<string | null | undefined> {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || !accountId) {
    throw new FolderAssignmentError();
  }
  const id = value.trim();
  const row = await db.prepare(
    'SELECT id FROM folders WHERE id = ? AND kind = ? AND account_id = ?',
  ).bind(id, kind, accountId).first<{ id: string }>();
  if (!row) throw new FolderAssignmentError();
  return id;
}
