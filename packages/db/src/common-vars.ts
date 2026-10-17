// Public entry point. Implementation is organized by responsibility.
export {
  COMMON_VAR_TYPES,
  type CommonVarType,
  type CommonVarResolutionFailureReason,
  type CommonVarResolutionEntry,
  type CommonVarResolution,
} from './common-vars-resolution-types.js';
export {
  normalizeCommonVarValue,
  isSecretLikeValue,
  normalizeCommonVarValidityAt,
  resolveCommonVarValuesAt,
} from './common-vars-values.js';
export {
  type CommonVar,
  type CommonVarExpiryBehavior,
  type CommonVarStatus,
  type CommonVarUsageKind,
} from './common-vars-record-types.js';
export {
  type CommonVarVersion,
  type CommonVarUsageImpact,
  type CommonVarUsageItem,
  type CommonVarUsageSummary,
  type CommonVarSchedule,
  type CommonVarExpiryCandidate,
  type CommonVarReplacementTarget,
  type CommonVarReplacementPlan,
} from './common-vars-types.js';
export {
  getCommonVarUsageCounts,
  getCommonVarUsageSummaries,
} from './common-vars-usage-queries.js';
export {
  countCommonVars,
  COMMON_VARS_LIST_LIMIT,
  getCommonVars,
  getCommonVarUsageImpact,
  getCommonVarById,
  getCommonVarByIdIncludingArchived,
  CommonVarVersionConflictError,
  CommonVarFolderError,
  CommonVarKeyConflictError,
  CommonVarReasonRequiredError,
  CommonVarStatusTransitionError,
  createCommonVar,
} from './common-vars-definitions.js';
export {
  updateCommonVar,
  setCommonVarStatus,
  listCommonVarExpiryCandidates,
  markCommonVarExpiryNotice,
  getCommonVarVersions,
  deleteCommonVar,
} from './common-vars-revisions.js';
export {
  getCommonVarReplacementCandidates,
  getCommonVarReplacementPlan,
  applyCommonVarReplacementPlan,
} from './common-vars-replacement.js';
export {
  getCommonVarMap,
  getCommonVarSchedules,
  createCommonVarSchedule,
  deleteCommonVarSchedule,
  isCommonVarsEnabled,
  applyDueCommonVarSchedules,
} from './common-vars-schedules.js';
