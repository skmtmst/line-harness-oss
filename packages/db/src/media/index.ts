// Public entry point. Implementation is organized by responsibility.
import { getMediaIdByR2Key, getMediaVersionKeys } from './storage-keys.js';
export { getMediaIdByR2Key, getMediaVersionKeys };
export {
  isMissingTableError,
  MEDIA_NEAR_LIMIT_SHARE,
  MediaReferenceAccountError,
  applyMediaUsageMutation,
  getMedia,
  countMedia,
  getMediaById,
  createMedia,
  updateMedia,
  deleteMedia,
  archiveMedia,
  restoreMedia,
} from './definitions.js';
export {
  MEDIA_KINDS,
  type MediaKind,
  MEDIA_REF_KINDS,
  type MediaRefKind,
  type Media,
  type MediaArchiveResult,
  mediaLiveContentPath,
} from './primitives.js';
export {
  type MediaUsage,
  type MediaDeleteImpactSnapshot,
  type MediaReplacementPlan,
  type MediaReplacementApplyScope,
  type MediaReplacementApplyResult,
  type MediaUsageReferenceMode,
  type MediaUsageReferenceState,
  type MediaUsageReferenceErrorCode,
  type MediaUsageScanState,
} from './types.js';
export {
  getMediaUsages,
  countMediaUsages,
  getMediaDeleteImpactSnapshot,
  getMediaDeleteImpact,
  getMediaReplacementPlan,
} from './impact.js';
export {
  applyMediaReplacementPlan,
} from './replacement.js';
export {
  getMediaUsageMatchTokens,
  getMediaUsageMatchTokenMap,
  getMediaLiveTarget,
  getMediaUsageReferenceStates,
  MediaUsageReferenceError,
  retargetMediaUsageReference,
} from './references.js';
export {
  recordMediaUsage,
  getMediaUsageScanState,
  saveMediaUsageScanState,
  recordMediaUsages,
  pruneStaleMediaUsages,
  pruneStaleMediaUsagesBatch,
} from './usage.js';
