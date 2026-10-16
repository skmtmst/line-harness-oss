import type { EntryRoute } from '@line-crm/db';

export function serialize(row: EntryRoute) {
  return {
    id: row.id,
    refCode: row.ref_code,
    genre: row.genre,
    name: row.name,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    redirectUrl: row.redirect_url,
    poolId: row.pool_id,
    introTemplateId: row.intro_template_id,
    couponAssetId: row.coupon_asset_id ?? null,
    couponEnabled: row.coupon_enabled === 1,
    couponAudience: row.coupon_audience ?? 'new_friends',
    runAccountFriendAddScenarios: row.run_account_friend_add_scenarios === 1,
    isActive: row.is_active === 1,
    stoppedAt: row.stopped_at ?? null,
    stoppedReason: row.stopped_reason ?? null,
    lineAccountId: row.line_account_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
