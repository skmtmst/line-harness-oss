export async function validateAfterActionVersion(
  db: D1Database,
  lineAccountId: string | null | undefined,
  versionId: string | null | undefined,
): Promise<boolean> {
  if (!versionId) return true;
  if (!lineAccountId) return false;
  const row = await db.prepare(
    `SELECT cav.id
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ? AND cav.status = 'published'
        AND ca.line_account_id = ? AND ca.status = 'published'`,
  ).bind(versionId, lineAccountId).first<{ id: string }>();
  return Boolean(row);
}
