// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { AutomationDefinitionError, listAutomationDefinitions, previewAutomationAudience, restoreAutomationDefinition, runAutomationTest, updateAutomationDefinitionStatus } from '../automation-definitions.js';
