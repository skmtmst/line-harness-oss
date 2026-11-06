// Public entry point. Implementation is organized by responsibility.
export {
  getTags,
  getTagsWithCounts,
} from '../tag-lists.js';
export type { TagReadScope } from '../tag-lists.js';
export {
  type Tag,
  type TagGroup,
  type FriendTag,
  type TagWithCount,
  type TagCleanupReason,
  type TagAssignSource,
  type TagWithUsage,
  type TagDeleteImpactReferences,
  type TagDeleteImpact,
  type CreateTagInput,
  type CreateTagsBulkInput,
  type CreateTagsBulkResult,
  type TagRetroactiveMileagePreview,
} from './types.js';
export {
  MAX_TAG_USAGE_COMPOUND_SELECT_TERMS,
  TAG_USAGE_BLOCKING_REFERENCE_SELECTS,
  buildTagUsageBlockingReferenceQueries,
  collectTagUsageBlockingTagIds,
  normalizeTagNameForCleanup,
  findTagByNormalizedName,
  assertTagNameAvailable,
} from './names.js';
export {
  getTagsWithUsage,
  getTagDeleteImpact,
} from './usage.js';
export {
  createTag,
  findOrCreateGlobalTag,
  createTagsBulk,
  assignTagToGroup,
  reorderTags,
  deleteTag,
  getTagGroups,
  createTagGroup,
  updateTagGroup,
  deleteTagGroup,
} from './definitions.js';
export {
  addTagToFriend,
  updateTagMileageSettings,
  tagRetroactiveEnqueueStatements,
  enqueueHistoricTagMileage,
  getTagRetroactiveMileagePreview,
} from './mileage.js';
export {
  removeTagFromFriend,
  getFriendTags,
  getFriendTagsByFriendIds,
  getFriendsByTag,
} from './friends.js';
