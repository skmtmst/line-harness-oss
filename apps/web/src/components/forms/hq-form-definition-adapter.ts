import { emptyLayout, layoutToFields, normalizeLayout, type FormLayout } from '@line-crm/shared'
import type { FormDefinition } from '@/lib/hq-templates-api'

export type HqFormEditorValue = {
  name: string
  description: string
  layout: FormLayout
  onSubmitTagId: string
  onSubmitScenarioId: string
  saveToMetadata: boolean
}

export function hqFormDefinitionToEditor(definition: FormDefinition): HqFormEditorValue {
  const layout = definition.form.layout == null ? null : normalizeLayout(definition.form.layout)
  return {
    name: definition.form.name,
    description: definition.form.description ?? '',
    layout: layout ?? emptyLayout(),
    onSubmitTagId: definition.form.on_submit_tag_id ?? '',
    onSubmitScenarioId: definition.form.on_submit_scenario_id ?? '',
    saveToMetadata: definition.form.save_to_metadata !== false,
  }
}

export function hqFormEditorToDefinition(value: HqFormEditorValue): FormDefinition {
  const layout = normalizeLayout(value.layout)
  if (!layout) throw new Error('フォームのレイアウトが壊れています。')
  return {
    schemaVersion: 1,
    form: {
      name: value.name.trim(),
      description: value.description.trim() || null,
      fields: layoutToFields(layout).map(field => ({
        name: field.name,
        label: field.label,
        type: field.type as FormDefinition['form']['fields'][number]['type'],
        required: field.required,
        options: field.options,
        placeholder: field.placeholder ?? null,
        description: field.description ?? null,
      })),
      layout,
      on_submit_tag_id: value.onSubmitTagId || null,
      on_submit_scenario_id: value.onSubmitScenarioId || null,
      save_to_metadata: value.saveToMetadata,
    },
  }
}

/**
 * The Worker performs the same fail-closed validation. Keeping this check in the
 * editor gives the operator a useful error before a preflight is created.
 */
export function hqFormPortableReferenceError(value: HqFormEditorValue): string | null {
  const unsupportedKeys = new Set([
    'friendFieldId', 'friendFieldIds', 'choiceFriendFieldId', 'fieldId',
    'templateId', 'reminderId', 'mediaUrl', 'backgroundImageUrl',
  ])
  const visit = (item: unknown): string | null => {
    if (Array.isArray(item)) {
      for (const child of item) { const error = visit(child); if (error) return error }
      return null
    }
    if (!item || typeof item !== 'object') return null
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (unsupportedKeys.has(key) && child != null && child !== '' && !(Array.isArray(child) && child.length === 0)) {
        return '店舗固有の友だち情報・テンプレート・リマインダ・画像はひな形へ保存できません。配布先で設定してください。'
      }
      const error = visit(child)
      if (error) return error
    }
    return null
  }
  return visit(value.layout)
}
