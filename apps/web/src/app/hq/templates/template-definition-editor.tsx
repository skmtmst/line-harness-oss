'use client'

import { useEffect, useRef, useState } from 'react'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import { freshDefinition, withUploadedImage } from '@/lib/hq-template-authoring'
import RichMenuCreateForm, { freshRichMenuCreateValue, type RichMenuOption } from '@/components/rich-menus/rich-menu-create-form'
import HqTagDefinitionEditor from '@/components/friend-fields/hq-tag-definition-editor'
import HqFormDefinitionEditor from '@/components/forms/hq-form-definition-editor'
import type { FormRefs } from '@/components/forms/form-refs'
import {
  HqRichMenuCompatibilityError,
  hqDefinitionToRichMenuCreateValue,
  richMenuCreateValueToHqDefinition,
} from '@/lib/hq-rich-menu-create'
export { freshDefinition } from '@/lib/hq-template-authoring'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MessageTemplateEditor,
} from '@/components/templates/message-template-editor'
import type {
  FormDefinition,
  MessageTemplateDefinition,
  RichMenuDefinition,
  TagDefinition,
  TemplateDefinition,
  TemplateType,
} from '@/lib/hq-templates-api'
import styles from './template-console.module.css'

export function definitionName(type: TemplateType, definition: TemplateDefinition): string {
  if (type === 'tag' && 'tag' in definition) return definition.tag.name
  if (type === 'template' && 'template' in definition) return definition.template.name
  if (type === 'rich_menu' && 'richMenu' in definition) return definition.richMenu.name
  if (type === 'form' && 'form' in definition) return definition.form.name
  return ''
}

export function definitionForName(type: TemplateType, definition: TemplateDefinition, name: string, description: string): TemplateDefinition {
  if (type === 'tag' && 'tag' in definition) return { ...definition, tag: { ...definition.tag, name, description: description || null } }
  if (type === 'template' && 'template' in definition) return { ...definition, template: { ...definition.template, name } }
  if (type === 'rich_menu' && 'richMenu' in definition) return { ...definition, richMenu: { ...definition.richMenu, name } }
  if (type === 'form' && 'form' in definition) return { ...definition, form: { ...definition.form, name, description: description || null } }
  return freshDefinition(type)
}

export function definitionError(type: TemplateType, definition: TemplateDefinition, tenantId?: string): string | null {
  if (!definitionName(type, definition).trim()) return 'ひな形の名前を入力してください。'
  if (type === 'tag' && 'tag' in definition) return definition.folders.some(folder => !folder.name.trim()) ? 'タググループ名を入力してください。' : null
  if (type === 'template' && 'template' in definition) return definition.template.messageContent.trim() ? null : '配信する本文を入力してください。'
  if (type === 'rich_menu' && 'richMenu' in definition) {
    if (!definition.richMenu.chatBarText.trim()) return 'トーク画面に表示する文字を入力してください。'
    if (!definition.richMenu.pages.length || definition.richMenu.pages.some(page => !page.name.trim() || !page.imageR2Key.trim())) return '各ページの名前と画像の保存先を入力してください。'
    if (tenantId && definition.richMenu.pages.some(page => !page.imageR2Key.startsWith(`hq-templates/${tenantId}/`))) return `画像の保存先は hq-templates/${tenantId}/ から始めてください。`
    for (const page of definition.richMenu.pages) for (const area of page.areas) {
      if (area.intent === 'url' && !area.actionData.uri?.trim()) return 'タップ先URLを入力してください。'
      if (area.intent === 'text' && !area.actionData.text?.trim()) return 'タップ時のメッセージを入力してください。'
      if (area.intent === 'form' && !area.formId?.trim()) return 'タップ先の回答フォームを入力してください。'
      if (area.intent === 'template' && !area.templateId?.trim()) return 'タップ先のテンプレートを入力してください。'
      if (area.scenarioId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(area.scenarioId)) return '追加で開始するシナリオの元IDを正しく入力してください。'
      if (area.scenarioId && !['text', 'template'].includes(String(area.intent))) return 'シナリオ開始は、メッセージまたはテンプレートを送るタップ動作に設定してください。'
    }
    return null
  }
  if (type === 'form' && 'form' in definition) {
    if (!definition.form.fields.length) return '質問を1件以上追加してください。'
    if (definition.form.fields.some(field => !field.name.trim() || !field.label.trim())) return '各質問の管理名と表示名を入力してください。'
    if (new Set(definition.form.fields.map(field => field.name.trim())).size !== definition.form.fields.length) return '質問の管理名は重複しない名前にしてください。'
  }
  return null
}

export function referenceCount(type: TemplateType, definition: TemplateDefinition): number {
  if (type === 'tag' && 'tag' in definition) return definition.folders.length
  if (type === 'template' && 'template' in definition) return definition.media.length
  if (type === 'rich_menu' && 'richMenu' in definition) return definition.richMenu.pages.reduce((sum, page) => sum + page.areas.reduce((count, area) => count + (area.formId ? 1 : 0) + (area.templateId ? 1 : 0) + (area.scenarioId ? 1 : 0) + (area.tagIds?.length ?? 0), 0), 0)
  if (type === 'form' && 'form' in definition) return Number(Boolean(definition.form.on_submit_tag_id)) + Number(Boolean(definition.form.on_submit_scenario_id))
  return 0
}

function ImageUpload({ purpose, disabled, onUploaded, onBusyChange }: { purpose: 'message' | 'rich_menu'; disabled: boolean; onUploaded: (media: MessageTemplateDefinition['media'][number]) => void; onBusyChange?: (busy: boolean) => void }) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false)
  const alive = useRef(true), locked = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange?.(false) } }, [onBusyChange])
  const upload = async (file?: File) => {
    if (!file || disabled || locked.current) return
    locked.current = true; setUploading(true); onBusyChange?.(true); setError('')
    try { const media = await hqTemplatesApi.uploadImage(file, purpose); if (alive.current) onUploaded(media) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '画像を登録できませんでした。') }
    finally { locked.current = false; if (alive.current) { setUploading(false); onBusyChange?.(false) } }
  }
  return <div className={styles.field}><span>画像を登録</span><input aria-label={purpose === 'message' ? 'メッセージ画像を選ぶ' : 'リッチメニュー画像を選ぶ'} type="file" accept="image/png,image/jpeg" disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file) }} /><small className={styles.muted}>{purpose === 'message' ? 'PNG・JPEG、1件8 MiB以下。画像形式では本文に自動設定します。' : 'PNG・JPEG、1 MiB以下。幅2500px、高さ1686pxまたは843px。'}</small>{uploading && <p role="status">画像を登録しています…</p>}{error && <p role="alert">{error}</p>}</div>
}

function MessageEditor({ value, disabled, onChange, onBusyChange }: { value: MessageTemplateDefinition; disabled: boolean; onChange: (next: MessageTemplateDefinition) => void; onBusyChange?: (busy: boolean) => void }) {
  const current = value.template
  const [targetDate, setTargetDate] = useState('')
  const messageTypeOptions = [
    { value: 'text', label: 'テキスト' },
    { value: 'flex', label: 'カード型' },
    { value: 'image', label: '画像' },
    // 既存データを開いて保存しても形式を落とさない。店舗側の専用編集画面へ
    // 移されるまで、HQで作成済みのカルーセルも選択肢として保持する。
    { value: 'carousel', label: 'カルーセル' },
  ]
  return (
    <MessageTemplateEditor
      value={{ messageType: current.messageType, messageContent: current.messageContent }}
      onChange={(next) => onChange({
        ...value,
        template: {
          ...current,
          messageType: next.messageType as MessageTemplateDefinition['template']['messageType'],
          messageContent: next.messageContent,
        },
      })}
      targetDate={targetDate}
      onTargetDateChange={setTargetDate}
      references={EMPTY_TEMPLATE_REFERENCES}
      referenceAccountId={null}
      referenceUnavailableHint="友だち情報と共通情報は店舗ごとに異なるため、配布先のLINEアカウントで設定してください。"
      disabled={disabled}
      typeOptions={messageTypeOptions}
      bodyAriaLabel="配信する本文"
      beforeType={(
        <>
          <label className={styles.field}>
            <span>分類</span>
            <input aria-label="テンプレートの分類" className={styles.input} value={current.category} maxLength={100} disabled={disabled} onChange={event => onChange({ ...value, template: { ...current, category: event.target.value } })} />
          </label>
          {current.id === 'hq-authored-message' && <ImageUpload purpose="message" disabled={disabled} onBusyChange={onBusyChange} onUploaded={media => onChange(withUploadedImage(value, media))} />}
          {value.media.map(media => <p key={media.id} className={styles.muted}>{media.filename}（{Math.ceil(media.sizeBytes / 1024)} KB）<br /><span className={styles.name}>{media.publicUrl ?? media.r2Key}</span></p>)}
        </>
      )}
    />
  )
}

export type RichMenuEditorReferences = {
  tags?: RichMenuOption[]
  templates?: RichMenuOption[]
  forms?: RichMenuOption[]
  trackedLinks?: RichMenuOption[]
}

function RichMenuEditor({ value, disabled, onChange, onBusyChange, onNameChange, references = {} }: { value: RichMenuDefinition; disabled: boolean; tenantId?: string; onChange: (next: RichMenuDefinition) => void; onBusyChange?: (busy: boolean) => void; onNameChange?: (name: string) => void; references?: RichMenuEditorReferences }) {
  const [changeError, setChangeError] = useState<string | null>(null)
  let compatibilityError: string | null = null
  let draft = freshRichMenuCreateValue()
  try { draft = hqDefinitionToRichMenuCreateValue(value) }
  catch (error) { compatibilityError = error instanceof Error ? error.message : '内容を安全に読み込めないため停止しました。' }
  const page = value.richMenu.pages[0]
  return <RichMenuCreateForm
    value={draft}
    disabled={disabled}
    compatibilityError={compatibilityError}
    validationError={changeError}
    tags={references.tags}
    templates={references.templates}
    forms={references.forms}
    trackedLinks={references.trackedLinks}
    onChange={next => {
      try { const converted = richMenuCreateValueToHqDefinition(next, value); onChange(converted); if (next.name !== value.richMenu.name) onNameChange?.(next.name); setChangeError(null) }
      catch (error) { setChangeError(error instanceof HqRichMenuCompatibilityError ? error.message : '変更を安全に保存できないため停止しました。') }
    }}
    imageAction={page ? <ImageUpload purpose="rich_menu" disabled={disabled || Boolean(compatibilityError)} onBusyChange={onBusyChange} onUploaded={media => {
      if (media.width !== 2500 || media.height !== (value.richMenu.size === 'large' ? 1686 : 843)) throw new Error('選択中のサイズに合う画像を指定してください。')
      onChange({ ...value, richMenu: { ...value.richMenu, pages: [{ ...page, imageR2Key: media.r2Key }, ...value.richMenu.pages.slice(1)] } })
    }} /> : null}
  />
}

export default function TemplateDefinitionEditor({ type, value, disabled, editing = false, tenantId, onChange, onBusyChange, richMenuReferences, formReferences, onRichMenuNameChange, onCanonicalSave, onCanonicalCancel }: { type: TemplateType; value: TemplateDefinition; disabled: boolean; editing?: boolean; tenantId?: string; onChange: (next: TemplateDefinition) => void; onBusyChange?: (busy: boolean) => void; richMenuReferences?: RichMenuEditorReferences; formReferences?: FormRefs; onRichMenuNameChange?: (name: string) => void; onCanonicalSave?: (definition: TagDefinition | FormDefinition) => void | Promise<void>; onCanonicalCancel?: () => void }) {
  if (type === 'tag' && 'tag' in value) return <HqTagDefinitionEditor definition={value} mode={editing ? 'edit' : 'create'} saving={disabled} onCancel={onCanonicalCancel ?? (() => undefined)} onSave={async next => { onChange(next); await onCanonicalSave?.(next) }} />
  if (type === 'template' && 'template' in value) return <MessageEditor value={value} disabled={disabled} onChange={onChange} onBusyChange={onBusyChange} />
  if (type === 'rich_menu' && 'richMenu' in value) return <RichMenuEditor value={value} disabled={disabled} tenantId={tenantId} onChange={onChange} onBusyChange={onBusyChange} onNameChange={onRichMenuNameChange} references={richMenuReferences} />
  if (type === 'form' && 'form' in value) return <HqFormDefinitionEditor definition={value} refs={formReferences} saving={disabled} onCancel={onCanonicalCancel ?? (() => undefined)} onSave={async next => { onChange(next); await onCanonicalSave?.(next) }} />
  return <p role="alert">ひな形の種類と保存内容が一致しません。</p>
}
