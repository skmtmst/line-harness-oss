import { describe, expect, it } from 'vitest'
import { readScenarioEditorDraft } from './hq-scenario-editor-draft'

const draft = () => ({ kind: 'scenario', name: '', description: '架空の説明', folderId: 'fake-folder', definition: { schemaVersion: 1, scenario: { name: '', description: null }, steps: [{ id: 'fake-step', delayMinutes: -1, messageType: 'text', messageContent: '' }] } })
describe('scenario editor draft', () => {
  it('保存前の空欄や検証前の値も残す', () => {
    expect(readScenarioEditorDraft(draft())).toMatchObject({ name: '', folderId: 'fake-folder', definition: { steps: [{ delayMinutes: -1, messageContent: '' }] } })
  })
  it.each([null, {}, { steps: null }, { schemaVersion: 1, scenario: {}, steps: [] }, { ...draft().definition, steps: [null] }, { ...draft().definition, steps: [draft().definition.steps[0], draft().definition.steps[0]] }])('壊れた構造は画面に渡さない: %j', definition => {
    expect(readScenarioEditorDraft({ ...draft(), definition })).toBeNull()
  })
  it('別種類の入力を使わない', () => {
    expect(readScenarioEditorDraft({ ...draft(), kind: 'form' })).toBeNull()
  })
})
