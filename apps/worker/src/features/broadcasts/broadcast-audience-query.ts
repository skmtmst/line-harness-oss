import { buildSegmentQuery, type SegmentCondition } from '@line-crm/db';
import { restrictSegmentInput } from '../../services/segment-query-scope.js';


/** 配信では条件の一致とは別に、ブロック中・非表示の相手を必ず除く。 */
export function buildBroadcastAudienceQuery(condition: SegmentCondition) {
  const query = buildSegmentQuery(condition);
  return restrictSegmentInput(query, 'f.is_following = 1 AND COALESCE(f.is_hidden, 0) = 0');
}
