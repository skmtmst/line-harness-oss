import type { SavedSearch } from '@line-crm/db';

export function serializeInboxSavedView(
  row: SavedSearch,
  count?: { matchCount: number; matchCountCapped: boolean },
) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    lineAccountId: row.line_account_id,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    isFavorite: row.display_order < 0,
    createdAt: row.created_at,
    matchCount: count?.matchCount ?? null,
    matchCountCapped: count?.matchCountCapped ?? false,
  };
}
