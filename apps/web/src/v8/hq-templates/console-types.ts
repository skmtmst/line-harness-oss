import type { ComponentType } from 'react'
import type { TemplateType, TemplateDefinition } from '@/lib/hq-templates-api'
import type { TemplateMedia } from './definition'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
/** 種類ごとの中身の編集部品（タグ・リッチメニュー・回答フォーム・シナリオ）。入口が今の部品を渡す。 */
export interface DefinitionEditorProps {
  type: TemplateType
  value: TemplateDefinition
  disabled: boolean
  editing?: boolean
  tenantId?: string
  onChange: (next: TemplateDefinition) => void
  onBusyChange?: (busy: boolean) => void
  onMediaUploaded?: (media: TemplateMedia) => void
  richMenuReferences?: { tags?: Array<{ id: string; name: string }>; templates?: Array<{ id: string; name: string }>; forms?: Array<{ id: string; name: string }> }
  formReferences?: import('@/components/forms/form-refs').FormRefs
  onRichMenuNameChange?: (name: string) => void
  onCanonicalSave?: (definition: Extract<TemplateDefinition, { tag: unknown } | { form: unknown }>, andAnother?: boolean) => void | Promise<void>
  onCanonicalCancel?: () => void
}

export interface ConsoleProps {
  type: TemplateType
  DefinitionEditor?: ComponentType<DefinitionEditorProps>
  RichMenuCreate?: ComponentType<{ host: RichMenuCreateHost }>
}
