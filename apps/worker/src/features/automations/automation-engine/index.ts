// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { AutomationActionError, AutomationRunCancelError, AutomationRunRetryError, COMMON_ACTION_MAX_BRANCH_DEPTH, COMMON_ACTION_MAX_DEPTH, COMMON_ACTION_MAX_STEPS, cancelAutomationRun, processDueAutomationRuns, retryAutomationRun } from '../automation-engine.js';
export type { ActionDefinition, AutomationActionContext, AutomationActionExecutor } from '../automation-engine.js';
