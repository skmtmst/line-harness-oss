import { type AdConversionOutboxRow, type RefTracking } from '@line-crm/db';



export function refFromOutboxSnapshot(row: AdConversionOutboxRow): RefTracking | null {
  if (row.selection_reason !== 'eligible'
    || !row.ref_tracking_id || !row.click_id || !row.click_id_type
    || !row.click_recorded_at || !row.click_expires_at || !row.click_consent_at) return null;
  let context: { ipAddress?: string | null; userAgent?: string | null } = {};
  try {
    context = row.click_context_json ? JSON.parse(row.click_context_json) as typeof context : {};
  } catch {
    return null;
  }
  const clicks = {
    fbclid: null, gclid: null, twclid: null, ttclid: null,
    [row.click_id_type]: row.click_id,
  } as Pick<RefTracking, 'fbclid' | 'gclid' | 'twclid' | 'ttclid'>;
  return {
    id: row.ref_tracking_id,
    ref_code: '',
    friend_id: row.friend_id,
    entry_route_id: null,
    source_url: null,
    ...clicks,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    user_agent: context.userAgent ?? null,
    ip_address: context.ipAddress ?? null,
    line_account_id: row.line_account_id,
    ad_conversion_consent_at: row.click_consent_at,
    created_at: row.click_recorded_at,
  };
}
