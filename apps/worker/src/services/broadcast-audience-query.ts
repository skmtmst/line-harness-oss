import { buildSegmentQuery, type SegmentCondition } from '@line-crm/db';

/** 配信では条件の一致とは別に、ブロック中・非表示の相手を必ず除く。 */
export function buildBroadcastAudienceQuery(condition: SegmentCondition) {
  const query = buildSegmentQuery(condition);
  return { ...query, sql: query.sql.replace('WHERE',
    'WHERE f.is_following = 1 AND COALESCE(f.is_hidden, 0) = 0 AND') };
}
