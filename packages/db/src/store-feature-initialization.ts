import { DEFAULT_TENANT_ID } from '@line-crm/shared';

/**
 * Append to the same batch as the profile save (after its CAS and write), or
 * the store creation. Read the persisted answers inside that transaction.
 * The (store_id, feature) row, including enabled=0, is the initialization mark.
 * Never update an existing row or copy other answers/delivery flags.
 */
export function storeFeatureInitialization(
  db: D1Database,
  accountId: string,
  tenantId: string | null,
  actorId: string,
  now: number,
  storeId: string | null = null,
): D1PreparedStatement {
  return db.prepare(`
    WITH initial_answers(question, feature) AS (
      VALUES ('booking', 'reservation'), ('coupons', 'coupon')
    )
    INSERT INTO rt_store_feature_flags
      (store_id, feature, enabled, updated_by, created_at, updated_at)
    SELECT s.id, i.feature,
      json_type(p.answers_json, '$.' || i.question || '.value') = 'true', ?, ?, ?
    FROM account_styles p
    JOIN line_accounts a ON a.id = p.line_account_id
    JOIN rt_stores s ON s.line_account_id = a.id
    JOIN rt_organizations o ON o.id = s.organization_id
    CROSS JOIN initial_answers i
    WHERE a.id = ? AND COALESCE(a.tenant_id, ?) = COALESCE(?, ?)
      AND a.is_active = 1 AND a.archived_at IS NULL
      AND s.status != 'archived' AND o.status != 'archived'
      AND ((o.tenant_id IS NOT NULL AND o.tenant_id = COALESCE(a.tenant_id, ?))
        OR (o.tenant_id IS NULL AND o.account_id = a.id))
      AND (? IS NULL OR s.id = ?)
      AND (SELECT COUNT(*) FROM rt_stores WHERE line_account_id = a.id) = 1
      AND json_extract(p.answers_json, '$.' || i.question || '.mode') = 'configured'
      AND json_type(p.answers_json, '$.' || i.question || '.value') IN ('true', 'false')
    ON CONFLICT(store_id, feature) DO NOTHING
  `).bind(actorId, now, now, accountId, DEFAULT_TENANT_ID, tenantId,
    DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, storeId, storeId);
}
