import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getFriendFieldsForScope } from './friend-fields.js';
import { getTagsWithUsage } from './tags/usage-references.js';

/** 一覧と同じ所属の定義を数え、友だちへの登録数と混同しない。 */
export async function getAttributeResourceUsage(db: D1Database, accountId: string) {
  const [tagRows, account] = await Promise.all([
    getTagsWithUsage(db, { allowedAccountIds: [accountId], canSeeUnassigned: false }),
    db.prepare('SELECT tenant_id FROM line_accounts WHERE id = ?').bind(accountId).first<{ tenant_id: string | null }>(),
  ]);
  const tags = tagRows.filter(tag => tag.status !== 'archived');
  const fields = account ? (await getFriendFieldsForScope(db, {
    tenantId: account.tenant_id ?? DEFAULT_TENANT_ID, lineAccountId: accountId,
  })).filter(field => field.status !== 'archived') : [];
  const [values, assigned] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT v.field_id) AS in_use, MAX(v.updated_at) AS last_used_at
    FROM friend_field_values v JOIN friends f ON f.id = v.friend_id
    WHERE f.line_account_id = ? AND v.value IS NOT NULL AND v.value != ''
      AND v.field_id IN (SELECT value FROM json_each(?))`)
    .bind(accountId, JSON.stringify(fields.map(field => field.id)))
    .first<{ in_use: number; last_used_at: string | null }>(),
    db.prepare(`SELECT MAX(ft.assigned_at) AS last_used_at
    FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
    WHERE f.line_account_id = ? AND ft.tag_id IN (SELECT value FROM json_each(?))`)
    .bind(accountId, JSON.stringify(tags.map(tag => tag.id))).first<{ last_used_at: string | null }>(),
  ]);
  const times = [assigned?.last_used_at, values?.last_used_at].filter((value): value is string => Boolean(value));
  return {
    tags: { key: 'tags' as const, label: 'タグ', href: '/tags', created: tags.length,
      inUse: tags.filter(tag => !tag.cleanup_reasons.includes('unused')).length,
      state: 'available' as const, reason: null },
    fields: { key: 'fields' as const, label: '友だち情報欄', href: '/tags?tab=fields', created: fields.length,
      inUse: Number(values?.in_use ?? 0), state: 'partial' as const,
      reason: 'このアカウントで値が登録された項目のみです。設定からの参照は含みません' },
    lastUsedAt: times.sort().at(-1) ?? null,
  };
}
