import type { HqScenarioDefinition } from '@line-crm/shared'
import type { EditorDraftContent } from './hq-template-create-attempt'

/** 未完成の空欄も復元するが、壊れた構造は画面へ渡さない。 */
export function readScenarioEditorDraft(draft: EditorDraftContent | null): {
  name: string; description: string; folderId: string | null; definition: HqScenarioDefinition
} | null {
  if (!draft || draft.kind !== 'scenario' || typeof draft.name !== 'string' || typeof draft.description !== 'string'
    || !(draft.folderId === null || typeof draft.folderId === 'string')) return null
  const definition = draft.definition as HqScenarioDefinition | null
  if (!definition || definition.schemaVersion !== 1 || !definition.scenario || typeof definition.scenario.name !== 'string'
    || !(definition.scenario.description === null || definition.scenario.description === undefined || typeof definition.scenario.description === 'string')
    || !Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length > 100) return null
  if (!definition.steps.every(step => step && typeof step.id === 'string' && step.id.length > 0
    && Number.isFinite(step.delayMinutes) && ['text', 'flex'].includes(step.messageType) && typeof step.messageContent === 'string')
    || new Set(definition.steps.map(step => step.id)).size !== definition.steps.length) return null
  return { name: draft.name, description: draft.description, folderId: draft.folderId, definition }
}
