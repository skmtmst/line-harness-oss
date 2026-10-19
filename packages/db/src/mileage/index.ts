// Public entry point. Implementation is organized by responsibility.
export {
  DEFAULT_MILEAGE_PROGRAM_ID,
  ensureDefaultMileageProgram,
  getAccountRuleVersionMap,
} from './program.js';
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
} from './types.js';
export {
  recordEngagementEvent,
  enqueueMileageEvent,
  postMileageEntry,
} from './events.js';
export {
  MileageAdjustmentError,
  findCommittedMileageAdjustment,
  postMileageAdjustment,
} from './adjustments.js';
export {
  getMileageSummaryForFriend,
  getMileageHistoryForFriend,
  getMileageSelfInsights,
  getMileageConnectedAccountsForFriend,
} from './wallet.js';
export {
  getMileageEarningOpportunitiesForFriend,
} from './opportunities.js';
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
} from './rules.js';
export {
  applyMileageRulesForEvent,
} from './grants.js';
export {
  processPendingMileageEvents,
  enqueueFollowingMileageMilestones,
} from './queue.js';
export {
  getMileageAdminOverview,
  getMileageAdminHistory,
} from './admin.js';
export {
  syncAffiliateConversionMileage,
} from './affiliate.js';
