import type { ConversionPoint } from '@line-crm/db';


export function serializeConversionPoint(p: ConversionPoint) {
  return {
    id: p.id,
    name: p.name,
    eventType: p.event_type,
    value: p.value,
    measureMethod: p.measure_method,
    targetUrl: p.target_url,
    countRepeat: p.count_repeat !== 0,
    attributionDays: p.attribution_days,
    lineAccountId: p.line_account_id,
    version: p.version,
    status: p.status,
    stoppedAt: p.stopped_at,
    createdAt: p.created_at,
  };
}
