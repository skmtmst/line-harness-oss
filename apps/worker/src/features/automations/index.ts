// Public operations. Internal modules import their dependencies directly.
export { AutomationActionError, AutomationRunCancelError, AutomationRunRetryError, COMMON_ACTION_MAX_BRANCH_DEPTH, COMMON_ACTION_MAX_DEPTH, COMMON_ACTION_MAX_STEPS, cancelAutomationRun, processDueAutomationRuns, retryAutomationRun } from './automation-engine.js';
export type { ActionDefinition, AutomationActionContext, AutomationActionExecutor } from './automation-engine.js';
export { createAutomationActionExecutors } from './automation-action-executors.js';
export type { AutomationActionExecutorDependencies } from './automation-action-executors.js';
export { dispatchAutomationEventWithLogging, processOverdueSupportMarkTriggers, processScheduledAutomationTriggers } from './automation-triggers.js';
export { AutomationDraftError, automationRevisionToken, createAutomationDraftFromDefinition, createAutomationDraftFromTemplate, duplicateAutomationDefinition, getAutomationDraft, listAutomationDraftResources, listAutomationTemplates, publishAutomationDraft, updateAutomationDraft } from './automation-drafts.js';
export { AutomationDefinitionError, listAutomationDefinitions, previewAutomationAudience, restoreAutomationDefinition, runAutomationTest, updateAutomationDefinitionStatus } from './automation-definitions.js';
