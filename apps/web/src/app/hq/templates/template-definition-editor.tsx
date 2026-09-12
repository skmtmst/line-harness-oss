'use client'

import { useEffect, useRef, useState } from 'react'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import { freshDefinition, withUploadedImage } from '@/lib/hq-template-authoring'
import RichMenuCreateForm, { freshRichMenuCreateValue, type RichMenuOption } from '@/components/rich-menus/rich-menu-create-form'
import {
  HqRichMenuCompatibilityError,
  hqDefinitionToRichMenuCreateValue,
  richMenuCreateValueToHqDefinition,
} from '@/lib/hq-rich-menu-create'
export { freshDefinition } from '@/lib/hq-template-authoring'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MessageTemplateEditor,
} from '@/components/templates/message-template-editor'
import type {
  FormDefinition,
  FormFieldType,
  MessageTemplateDefinition,
  RichMenuDefinition,
  TagDefinition,
  TemplateDefinition,
  TemplateType,
} from '@/lib/hq-templates-api'
import styles from './template-console.module.css'

const fieldTypes: Array<{ value: FormFieldType; label: string }> = [
  { value: 'text', label: '1行入力' }, { value: 'textarea', label: '複数行入力' },
  { value: 'radio', label: '1つ選択' }, { value: 'checkbox', label: '複数選択' },
  { value: 'select', label: '選択欄' }, { value: 'date', label: '日付' },
  { value: 'prefecture', label: '都道府県' }, { value: 'file', label: 'ファイル' },
]


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

function TagEditor({ value, disabled, onChange }: { value: TagDefinition; disabled: boolean; onChange: (next: TagDefinition) => void }) {
  return <>
    <label className={styles.field}><span>色</span><input aria-label="タグの色" className={styles.colorInput} type="color" value={value.tag.color ?? '#3B82F6'} disabled={disabled} onChange={event => onChange({ ...value, tag: { ...value.tag, color: event.target.value } })} /></label>
    <section className={styles.subpanel}><div className={styles.toolbar}><div><h2>一緒に配布するタググループ</h2><p className={styles.muted}>上から順に親子関係として配布します。</p></div><Button disabled={disabled || value.folders.length >= 8} onClick={() => { const id = `folder-${value.folders.length + 1}`; const parentId = value.folders.at(-1)?.id ?? null; onChange({ ...value, tag: { ...value.tag, folderId: id }, folders: [...value.folders, { id, name: '', parentId, color: null }] }) }}>＋グループ</Button></div>
      {value.folders.map((folder, index) => <div key={folder.id} className={styles.editorRow}><label className={styles.grow}><span className={styles.fieldLabel}>グループ {index + 1}</span><input aria-label={`タググループ ${folder.id}`} className={styles.input} value={folder.name} disabled={disabled} onChange={event => onChange({ ...value, folders: value.folders.map(item => item.id === folder.id ? { ...item, name: event.target.value } : item) })} /></label><Button disabled={disabled} onClick={() => { const folders = value.folders.filter(item => item.id !== folder.id).map(item => item.parentId === folder.id ? { ...item, parentId: folder.parentId ?? null } : item); onChange({ ...value, tag: { ...value.tag, folderId: value.tag.folderId === folder.id ? folders.at(-1)?.id ?? null : value.tag.folderId }, folders }) }}>削除</Button></div>)}
      {!value.folders.length && <p className={styles.emptySmall}>グループなしでタグだけを配布します。</p>}
    </section>
  </>
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

function FormEditor({ value, disabled, onChange }: { value: FormDefinition; disabled: boolean; onChange: (next: FormDefinition) => void }) {
  const form = value.form
  const advanced = form.layout !== null
  const setForm = (patch: Partial<FormDefinition['form']>) => onChange({ ...value, form: { ...form, ...patch } })
  return <>
    <section className={styles.subpanel}>{advanced && <p className={styles.notice}>このフォームには分岐や装飾を含む高度な構成があります。ここでは質問を表示だけにして、既存の構成をそのまま保存します。</p>}<div className={styles.toolbar}><div><h2>質問</h2><p className={styles.muted}>配布先では非公開の下書きになります。</p></div><Button disabled={disabled || advanced || form.fields.length >= 100} onClick={() => setForm({ fields: [...form.fields, { name: `question_${form.fields.length + 1}`, label: `質問${form.fields.length + 1}`, type: 'text', required: false }] })}>＋質問</Button></div>
      {form.fields.map((field, index) => <div className={styles.question} key={`${index}-${field.name}`}><div className={styles.twoColumns}><label className={styles.field}><span>表示名</span><input aria-label={`質問${index + 1}の表示名`} className={styles.input} value={field.label} maxLength={200} disabled={disabled || advanced} onChange={event => setForm({ fields: form.fields.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></label><label className={styles.field}><span>管理名</span><input aria-label={`質問${index + 1}の管理名`} className={styles.input} value={field.name} maxLength={200} disabled={disabled || advanced} onChange={event => setForm({ fields: form.fields.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label></div><div className={styles.editorRow}><Select aria-label={`質問${index + 1}の形式`} size="full" value={field.type} disabled={disabled || advanced} options={fieldTypes} onChange={type => setForm({ fields: form.fields.map((item, i) => i === index ? { ...item, type: type as FormFieldType } : item) })} /><label className={styles.checkLabel}><input type="checkbox" checked={field.required ?? false} disabled={disabled || advanced} onChange={event => setForm({ fields: form.fields.map((item, i) => i === index ? { ...item, required: event.target.checked } : item) })} /> 必須</label><Button disabled={disabled || advanced || form.fields.length === 1} onClick={() => setForm({ fields: form.fields.filter((_, i) => i !== index) })}>削除</Button></div>{['radio', 'checkbox', 'select'].includes(field.type) && <label className={styles.field}><span>選択肢（1行に1つ）</span><textarea aria-label={`質問${index + 1}の選択肢`} className={styles.input} rows={3} disabled={disabled || advanced} value={(field.options ?? []).join('\n')} onChange={event => setForm({ fields: form.fields.map((item, i) => i === index ? { ...item, options: event.target.value.split('\n').map(option => option.trim()).filter(Boolean) } : item) })} /></label>}</div>)}
    </section>
    <section className={styles.subpanel}><h2>回答後の動作</h2><div className={styles.twoColumns}><label className={styles.field}><span>付けるタグの元ID（任意）</span><input aria-label="回答後に付けるタグ" className={styles.input} value={form.on_submit_tag_id ?? ''} maxLength={160} disabled={disabled} onChange={event => setForm({ on_submit_tag_id: event.target.value || null })} /></label><label className={styles.field}><span>開始するシナリオの元ID（任意）</span><input aria-label="回答後に開始するシナリオ" className={styles.input} value={form.on_submit_scenario_id ?? ''} maxLength={160} disabled={disabled} onChange={event => setForm({ on_submit_scenario_id: event.target.value || null })} /></label></div><label className={styles.checkLabel}><input type="checkbox" checked={form.save_to_metadata} disabled={disabled} onChange={event => setForm({ save_to_metadata: event.target.checked })} /> 回答を友だち情報にも保存する</label></section>
  </>
}

export default function TemplateDefinitionEditor({ type, value, disabled, tenantId, onChange, onBusyChange, richMenuReferences, onRichMenuNameChange }: { type: TemplateType; value: TemplateDefinition; disabled: boolean; tenantId?: string; onChange: (next: TemplateDefinition) => void; onBusyChange?: (busy: boolean) => void; richMenuReferences?: RichMenuEditorReferences; onRichMenuNameChange?: (name: string) => void }) {
  if (type === 'tag' && 'tag' in value) return <TagEditor value={value} disabled={disabled} onChange={onChange} />
  if (type === 'template' && 'template' in value) return <MessageEditor value={value} disabled={disabled} onChange={onChange} onBusyChange={onBusyChange} />
  if (type === 'rich_menu' && 'richMenu' in value) return <RichMenuEditor value={value} disabled={disabled} tenantId={tenantId} onChange={onChange} onBusyChange={onBusyChange} onNameChange={onRichMenuNameChange} references={richMenuReferences} />
  if (type === 'form' && 'form' in value) return <FormEditor value={value} disabled={disabled} onChange={onChange} />
  return <p role="alert">ひな形の種類と保存内容が一致しません。</p>
}
