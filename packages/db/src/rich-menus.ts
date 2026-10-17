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
} from './rich-menus-types.js';
export {
  buildRichMenuAliasId,
  getRichMenuGroupById,
  getRichMenuDeleteImpact,
  getRichMenuGroupWithPages,
} from './rich-menus-reads.js';
export {
  parseRichMenuTagIds,
  getRichMenuGroups,
} from './rich-menus-area-writes.js';
export {
  createRichMenuGroup,
  updateRichMenuGroupMeta,
  replaceRichMenuPages,
  saveRichMenuGroupDraft,
  deleteRichMenuGroup,
  setRichMenuPageImage,
  pageBelongsToGroup,
} from './rich-menus-drafts.js';
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
} from './rich-menus-publish.js';
export {
  getRichMenuAreaTapTarget,
  recordRichMenuAreaTap,
  recordRichMenuAssignment,
  recordRichMenuAssignmentsByLineUserIds,
  clearRichMenuAssignmentsForGroup,
  getRichMenuAudienceStats,
  getRichMenuTapStats,
} from './rich-menus-audience.js';
export {
  getRichMenuTargetingCandidates,
  countRichMenuTargetingRules,
  normalizeRichMenuSearchText,
  listRichMenuGroupIdsByAreaLabel,
} from './rich-menus-targeting.js';
export {
  getRichMenuDuplicateByKey,
  duplicateRichMenuGroupAtomic,
} from './rich-menus-duplicates.js';
