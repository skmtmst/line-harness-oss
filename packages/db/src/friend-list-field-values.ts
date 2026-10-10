import { BASIC_FRIEND_FIELDS, DEFAULT_TENANT_ID, ageFromBirthday, allergyValues } from '@line-crm/shared';

/** 2,000件でも1回。ID一覧はJSONで束ね、D1のbind数上限を越えない。 */
export async function getFriendListFieldValues(db: D1Database, input: {
  friendIds: string[]; columns: string[]; tenantId: string; canSeePersonal: boolean;
}): Promise<Map<string, Record<string, string | null>>> {
  const values = new Map<string, Record<string, string | null>>();
  if (!input.friendIds.length || !input.columns.length) return values;
  const result = await db.prepare(`
    SELECT f.id AS friend_id, wanted.value AS column_key, fv.value,
           ff.field_key, birth.value AS birthday
      FROM json_each(?) ids
      JOIN friends f ON f.id = ids.value
      LEFT JOIN line_accounts a ON a.id = f.line_account_id
      JOIN json_each(?) wanted
      JOIN friend_fields ff ON wanted.value = 'field:' || ff.id
        OR wanted.value = 'fixed:' || substr(ff.field_key, 7)
      LEFT JOIN friend_field_scopes scope ON scope.field_id = ff.id
      LEFT JOIN friend_field_values fv ON fv.friend_id = f.id AND fv.field_id = ff.id
      LEFT JOIN friend_field_values birth ON birth.friend_id = f.id
        AND birth.field_id = 'fixed-birthday' AND ff.field_key = 'fixed_age'
     WHERE COALESCE(a.tenant_id, ?) = ? AND ff.status != 'archived'
       AND (ff.is_personal = 0 OR ? = 1)
       AND (ff.field_key IN (SELECT 'fixed_' || value FROM json_each(?))
         OR (COALESCE(scope.tenant_id, ?) = ?
           AND (scope.line_account_id IS NULL OR scope.line_account_id = f.line_account_id)))
  `).bind(JSON.stringify(input.friendIds), JSON.stringify(input.columns), DEFAULT_TENANT_ID, input.tenantId,
    input.canSeePersonal ? 1 : 0, JSON.stringify(BASIC_FRIEND_FIELDS.map(field => field.key)),
    '00000000-0000-4000-8000-000000000001', input.tenantId)
    .all<{friend_id: string; column_key: string; value: string | null; field_key: string; birthday: string | null}>();
  for (const row of result.results) {
    let value = row.value;
    if (row.field_key === 'fixed_allergy') value = allergyValues(value).join('・') || null;
    if (row.field_key === 'fixed_age') value = String(ageFromBirthday(row.birthday) ?? value ?? '') || null;
    const record = values.get(row.friend_id) ?? {};
    record[row.column_key] = value;
    values.set(row.friend_id, record);
  }
  return values;
}
