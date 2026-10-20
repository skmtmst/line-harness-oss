// Public operations. Internal modules import their dependencies directly.
export { processFriendFieldReminders } from './friend-field-reminders.js';
export { FriendBulkRunError, createFriendBulkUndoRun, previewFriendBulkRun, processDueFriendBulkRuns, processFriendBulkRun, requireFriendBulkRunAccess, retryFriendBulkRun, startFriendBulkRun } from './friend-bulk-runs.js';
export { friendMetadataPatchStatement, patchFriendMetadata } from './friend-metadata.js';
export { attachTagAndFireSideEffects, detachTagAndFireSideEffects } from './friend-tag-attach.js';
export { getFriendProfileCandidates, resolveFriendProfileSelections, resolveProfileCandidateSelections } from './friend-profile-candidates.js';
export type { ProfileCandidateSelectionReference } from './friend-profile-candidates.js';
export { applyFriendAddRouting, areFriendAddConditionsOverlapping, collectFriendAddReferences, doFriendAddTimeWindowsOverlap, doFriendAddWeekdaySetsOverlap, evaluateFriendAddRuleConditions, evaluateFriendAddSchedule, findFriendAddUnusableReferences, friendAddJstHhmm, hasInvalidFriendAddTimeWindows, isValidFriendAddHhmm, parseFriendAddConditionAst, retryFailedFriendAddActions } from './friend-add-routing.js';
export type { FriendAddSuppressReason } from './friend-add-routing-pick-string.js';
export { approveBulkMessage, getBulkMessageApproval } from './friend-bulk-message-approval.js';
export { getFriendUpcomingItems } from './friend-upcoming-items.js';
export { detectFriendDuplicateCandidates } from './friend-duplicate-candidates.js';
export { issueFriendAddCoupon } from './friend-add-coupon.js';
