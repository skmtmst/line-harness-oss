// Public entry point. Implementation is organized by responsibility.
export {
  DEFAULT_MILEAGE_PROGRAM_ID,
  ensureDefaultMileageProgram,
  getAccountRuleVersionMap,
} from './mileage-program.js';
export {
  type MileageEntryType,
  type MileageEntryStatus,
  type EngagementEvent,
  type MileageLedgerEntry,
  type RecordEngagementEventInput,
  type EnqueueMileageEventInput,
  type PostMileageEntryInput,
  type MileageAdjustmentErrorCode,
  type PostMileageAdjustmentInput,
  type MileageAdjustmentResult,
  type MileageSummary,
  type MileageHistoryItem,
  type MileageSelfInsights,
  type MileageConnectedAccount,
  type MileageEarningOpportunity,
  type MileageRuleRow,
  type MileageRuleConditions,
  type PublishedEarningRuleContent,
  type ApplyMileageRulesInput,
  type MileageMultiplier,
  type MileageQueueResult,
  type FollowingMileageReconcileResult,
  type MileageAdminMember,
  type MileageAdminOverview,
  type MileageAdminHistoryItem,
  type MileageAdminHistory,
} from './mileage-types.js';
export {
  recordEngagementEvent,
  enqueueMileageEvent,
  postMileageEntry,
} from './mileage-events.js';
export {
  MileageAdjustmentError,
  findCommittedMileageAdjustment,
  postMileageAdjustment,
} from './mileage-adjustments.js';
export {
  getMileageSummaryForFriend,
  getMileageHistoryForFriend,
  getMileageSelfInsights,
  getMileageConnectedAccountsForFriend,
} from './mileage-wallet.js';
export {
  getMileageEarningOpportunitiesForFriend,
} from './mileage-opportunities.js';
export {
  getMileageRules,
  getMileageRuleById,
  createMileageRule,
  parsePublishedSnapshot,
  getPublishedVersionContent,
  publishedRuleContentFromDraft,
  resolvePinnedRuleRow,
  updateMileageRule,
  deleteMileageRule,
} from './mileage-rules.js';
export {
  applyMileageRulesForEvent,
} from './mileage-grants.js';
export {
  processPendingMileageEvents,
  enqueueFollowingMileageMilestones,
} from './mileage-queue.js';
export {
  getMileageAdminOverview,
  getMileageAdminHistory,
} from './mileage-admin.js';
export {
  syncAffiliateConversionMileage,
} from './mileage-affiliate.js';
