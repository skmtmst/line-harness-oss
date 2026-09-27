/*
 * 友だちの絞り込み条件(SQL組み立て)の再公開口。
 *
 * 実体は `@line-crm/db` の `segment-conditions` に移った(R40)。
 * 既存の呼び出し(`services/segment-query.js` からの import)は
 * そのまま動く。新規の呼び出しは直接 `@line-crm/db` を使うこと。
 */
export {
  buildPublicSegmentQuery,
  buildSegmentQuery,
  buildSegmentWhere,
  matchesCondition,
  parseCondition,
  type ChatStatus,
  type FieldOperator,
  type ReactionState,
  type SegmentCondition,
  type SegmentRule,
} from '@line-crm/db';
