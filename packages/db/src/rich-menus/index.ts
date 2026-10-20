// Public entry point. Implementation is organized by responsibility.
export {
  type RichMenuGroup,
  type RichMenuPage,
  type RichMenuAreaIntent,
  type RichMenuArea,
  type RichMenuAreaInput,
  type RichMenuPageInput,
  type CreateRichMenuGroupInput,
  type UpdateRichMenuGroupMetaInput,
  type RichMenuAreaWithParsed,
  type RichMenuPageWithAreas,
  type RichMenuGroupWithPages,
  type RichMenuDeleteImpactReferenceKind,
  type RichMenuDeleteImpactReference,
  type RichMenuDeleteImpactIncomingSwitch,
  type RichMenuDeleteImpactNextCandidate,
  type RichMenuDeleteImpact,
  type SaveRichMenuGroupDraftInput,
  type SaveRichMenuGroupDraftResult,
  type PublishLeaseFence,
  type RichMenuAreaTapTarget,
  type RichMenuAreaTapCount,
  type RichMenuTapStats,
  type RichMenuAudienceStat,
  type RecordRichMenuAssignmentInput,
  type RichMenuTargetingCandidate,
  type RichMenuDuplicateRequest,
  type DuplicateRichMenuGroupOutcome,
} from './types.js';
export {
  buildRichMenuAliasId,
  getRichMenuGroupById,
  getRichMenuDeleteImpact,
  getRichMenuGroupWithPages,
} from './reads.js';
export {
  parseRichMenuTagIds,
  getRichMenuGroups,
} from './area-writes.js';
export {
  createRichMenuGroup,
  updateRichMenuGroupMeta,
  replaceRichMenuPages,
  saveRichMenuGroupDraft,
  deleteRichMenuGroup,
  setRichMenuPageImage,
  pageBelongsToGroup,
} from './drafts.js';
export {
  PUBLISH_LEASE_MS,
  publishLeaseExpiresAt,
  acquirePublishLease,
  renewPublishLease,
  releasePublishLease,
  isPublishLeaseHeld,
  setPageRichMenuId,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
} from './publish.js';
export {
  getRichMenuAreaTapTarget,
  recordRichMenuAreaTap,
  recordRichMenuAssignment,
  recordRichMenuAssignmentsByLineUserIds,
  clearRichMenuAssignmentsForGroup,
  getRichMenuAudienceStats,
  getRichMenuTapStats,
} from './audience.js';
export {
  getRichMenuTargetingCandidates,
  countRichMenuTargetingRules,
  normalizeRichMenuSearchText,
  listRichMenuGroupIdsByAreaLabel,
} from './targeting.js';
export {
  getRichMenuDuplicateByKey,
  duplicateRichMenuGroupAtomic,
} from './duplicates.js';
