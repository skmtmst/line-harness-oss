import { describe, expect, test } from 'vitest'
import { emptyLayout } from '@line-crm/shared'
import { hqFormDefinitionToEditor, hqFormEditorToDefinition, hqFormPortableReferenceError } from './hq-form-definition-adapter'
import type { FormDefinition } from '@/lib/hq-templates-api'

const definition = (): FormDefinition => ({ schemaVersion: 1, form: { name: 'アンケート', description: null, fields: [], layout: emptyLayout(), on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } })

describe('HQ form editor adapter', () => {
  test('full layout survives an editor round trip and fields are derived', () => {
    const source = definition()
    source.form.layout!.sections[0].blocks.push({ id: 'q1', kind: 'input', type: 'text', name: 'answer', label: '回答', required: true })
    const editor = hqFormDefinitionToEditor(source)
    const saved = hqFormEditorToDefinition(editor)
    expect(saved.form.layout).toEqual(source.form.layout)
    expect(saved.form.fields).toEqual([{ name: 'answer', label: '回答', type: 'text', required: true, options: undefined, placeholder: null, description: null }])
  })

  test('store-only references are rejected instead of dropped', () => {
    const editor = hqFormDefinitionToEditor(definition())
    editor.layout.sections[0].blocks.push({ id: 'q1', kind: 'input', type: 'text', name: 'answer', label: '回答', destinations: { friendFieldIds: ['field-1'] } })
    expect(hqFormPortableReferenceError(editor)).toContain('店舗固有')
  })
})

