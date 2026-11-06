// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { AutomationDraftError, automationRevisionToken, createAutomationDraftFromDefinition, createAutomationDraftFromTemplate, duplicateAutomationDefinition, getAutomationDraft, listAutomationDraftResources, listAutomationTemplates, publishAutomationDraft, updateAutomationDraft } from '../automation-drafts.js';
