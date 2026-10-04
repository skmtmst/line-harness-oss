'use client'

import { useEffect, useRef, useState } from 'react'
import { parseHqMessageCard, type HqMessageCard, type HqMessageReference } from '@line-crm/shared'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import { decodeImageSize } from './image-size'
import { freshDefinition, withUploadedImage, withMessageCard } from '@/lib/hq-template-authoring'
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
  if (type === 'scenario' && 'scenario' in definition) return definition.scenario.name
  if (type === 'tag' && 'tag' in definition) return definition.tag.name
  if (type === 'template' && 'template' in definition) return definition.template.name
  if (type === 'rich_menu' && 'richMenu' in definition) return definition.richMenu.name
  if (type === 'form' && 'form' in definition) return definition.form.name
  return ''
}

export function definitionForName(type: TemplateType, definition: TemplateDefinition, name: string, description: string): TemplateDefinition {
  if (type === 'scenario' && 'scenario' in definition) return {...definition,scenario:{name,description:description || null}}
  if (type === 'tag' && 'tag' in definition) return { ...definition, tag: { ...definition.tag, name, description: description || null } }
  if (type === 'template' && 'template' in definition) return { ...definition, template: { ...definition.template, name } }
  if (type === 'rich_menu' && 'richMenu' in definition) return { ...definition, richMenu: { ...definition.richMenu, name } }
  if (type === 'form' && 'form' in definition) return { ...definition, form: { ...definition.form, name, description: description || null } }
  return freshDefinition(type)
}

export function definitionError(type: TemplateType, definition: TemplateDefinition, tenantId?: string): string | null {
  if (!definitionName(type, definition).trim()) return 'ひな形の名前を入力してください。'
  if (type === 'scenario' && 'scenario' in definition) return definition.steps.length && definition.steps.every(step=>step.messageContent.trim() && Number.isSafeInteger(step.delayMinutes) && step.delayMinutes>=0) ? null : '各ステップの本文と遅延を入力してください。'
  if (type === 'tag' && 'tag' in definition) return definition.folders.some(folder => !folder.name.trim()) ? 'タググループ名を入力してください。' : null
  if (type === 'template' && 'template' in definition) {
    if (definition.card) {
      try { parseHqMessageCard(definition.card) } catch (error) { return error instanceof Error ? error.message : '入力内容を確認してください。' }
    }
    return definition.template.messageContent.trim() ? null : '配信する本文を入力してください。'
  }
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

export function ImageUpload({ purpose, disabled, expectedSize, onUploaded, onBusyChange, onReceipt }: { purpose: 'message' | 'rich_menu'; disabled: boolean; expectedSize?: { width: number; height: number } | null; onUploaded: (media: MessageTemplateDefinition['media'][number]) => void; onBusyChange?: (busy: boolean) => void; onReceipt?: (media: MessageTemplateDefinition['media'][number]) => void }) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false)
  const alive = useRef(true), locked = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange?.(false) } }, [onBusyChange])
  const upload = async (file?: File) => {
    if (!file || disabled || locked.current) return
    locked.current = true; setUploading(true); onBusyChange?.(true); setError('')
    try {
      // R568: 今の大きさで採用できない画像は、R2 へ送る前にここで止める。
      // 手元で読めないときは送って、採用できる寸法の宣言でサーバに止めてもらう。
      if (expectedSize) {
        const decoded = await decodeImageSize(file)
        if (decoded && (decoded.width !== expectedSize.width || decoded.height !== expectedSize.height)) throw new Error('選択中のサイズに合う画像を指定してください。')
      }
      const media = expectedSize && purpose === 'rich_menu'
        ? await hqTemplatesApi.uploadImage(file, purpose, expectedSize)
        : await hqTemplatesApi.uploadImage(file, purpose)
      // R568: 受け取りの記録を先に残す。採用に失敗しても、取り消しの後片付けが拾える。
      if (alive.current) { onReceipt?.(media); onUploaded(media) }
    }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '画像を登録できませんでした。') }
    finally { locked.current = false; if (alive.current) { setUploading(false); onBusyChange?.(false) } }
  }
  return <div className={styles.field}><span>画像を登録</span><input aria-label={purpose === 'message' ? 'メッセージ画像を選ぶ' : 'リッチメニュー画像を選ぶ'} type="file" accept="image/png,image/jpeg" disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file) }} /><small className={styles.muted}>{purpose === 'message' ? 'PNG・JPEG、1件8 MiB以下。画像形式では本文に自動設定します。' : 'PNG・JPEG、1 MiB以下。幅2500px、高さ1686pxまたは843px。'}</small>{uploading && <p role="status">画像を登録しています…</p>}{error && <p role="alert">{error}</p>}</div>
}

function CardEditor({ value, disabled, onChange, onBusyChange, onReceipt }: { value: MessageTemplateDefinition; disabled: boolean; onChange: (next: MessageTemplateDefinition) => void; onBusyChange?: (busy: boolean) => void; onReceipt?: (media: MessageTemplateDefinition['media'][number]) => void }) {
  const card: HqMessageCard = value.card ?? { format: 'text', title: '', body: value.template.messageContent, buttons: [] }
  const [references, setReferences] = useState<HqMessageReference[]>([]), [referenceError, setReferenceError] = useState('')
  const load = () => hqTemplatesApi.messageReferences().then(rows => { setReferences(rows); setReferenceError('') }).catch(() => setReferenceError('ボタンの参照先を取得できませんでした。入力を残したまま再読み込みできます。'))
  useEffect(() => {
    let alive = true
    void hqTemplatesApi.messageReferences().then(rows => { if (alive) setReferences(rows) }).catch(() => { if (alive) setReferenceError('ボタンの参照先を取得できませんでした。入力を残したまま再読み込みできます。') })
    return () => { alive = false }
  }, [])
  const update = (next: HqMessageCard) => onChange(withMessageCard(value, next))
  const updateButton = (id: string, patch: Partial<HqMessageCard['buttons'][number]>) => update({ ...card, buttons: card.buttons.map(button => button.id === id ? { ...button, ...patch } : button) })
  return <div className={styles.stack}>
    <label className={styles.field}>形式<select className={styles.input} aria-label="ひな形の形式" value={card.format} disabled={disabled} onChange={event => update({ ...card, format: event.target.value as HqMessageCard['format'] })}><option value="text">テキスト</option><option value="flex">カード型</option></select></label>
    <label className={styles.field}>タイトル<input className={styles.input} aria-label="ひな形のタイトル" maxLength={200} value={card.title} disabled={disabled} onChange={event => update({ ...card, title: event.target.value })} /></label>
    <label className={styles.field}>本文<textarea className={styles.textarea} aria-label="配信する本文" maxLength={card.format === 'flex' ? 2000 : 5000} value={card.body} disabled={disabled} onChange={event => update({ ...card, body: event.target.value })} /></label>
    {card.format === 'flex' && <>
      <ImageUpload purpose="message" disabled={disabled} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={media => { const next = withUploadedImage(value, media); onChange(withMessageCard(next, { ...card, imageMediaId: media.id })) }} />
      {card.imageMediaId && <button type="button" disabled={disabled} onClick={() => { const { imageMediaId: removed, ...next } = card; update(next) }}>画像を外す</button>}
      <h2>ボタン</h2>
      {referenceError && <p role="alert">{referenceError}<button type="button" disabled={disabled} onClick={() => void load()}>参照先を再読み込み</button></p>}
      {card.buttons.map((button, index) => <div key={button.id} className={styles.stack}>
        <label className={styles.field}>ボタン{index + 1}の文字<input className={styles.input} aria-label={`ボタン${index + 1}の文字`} maxLength={20} disabled={disabled} value={button.label} onChange={event => updateButton(button.id, { label: event.target.value })} /></label>
        <label className={styles.field}>押したとき<select className={styles.input} aria-label={`ボタン${index + 1}を押したとき`} disabled={disabled} value={button.action} onChange={event => updateButton(button.id, { action: event.target.value as typeof button.action, value: '' })}><option value="url">URLを開く</option><option value="message">メッセージを送る</option><option value="form">フォームを開く</option><option value="scenario">シナリオを開始</option></select></label>
        {button.action === 'form' || button.action === 'scenario'
          ? <label className={styles.field}>参照先<select className={styles.input} aria-label={`ボタン${index + 1}の参照先`} disabled={disabled || !!referenceError} value={button.value} onChange={event => updateButton(button.id, { value: event.target.value })}><option value="">選択してください</option>{button.value && !references.some(row => row.kind === button.action && row.id === button.value) && <option value={button.value}>保存済みの参照先（候補を確認してください）</option>}{references.filter(row => row.kind === button.action).map(row => <option key={row.id} value={row.id}>{row.name}（{row.accountName}）</option>)}</select></label>
          : <label className={styles.field}>{button.action === 'url' ? 'URL' : 'メッセージ'}<input className={styles.input} aria-label={`ボタン${index + 1}の内容`} maxLength={button.action === 'message' ? 300 : 2000} disabled={disabled} value={button.value} onChange={event => updateButton(button.id, { value: event.target.value })} /></label>}
        <button type="button" disabled={disabled} onClick={() => update({ ...card, buttons: card.buttons.filter(row => row.id !== button.id) })}>ボタン{index + 1}を外す</button>
      </div>)}
      <button type="button" disabled={disabled || card.buttons.length >= 3} onClick={() => update({ ...card, buttons: [...card.buttons, { id: crypto.randomUUID(), label: '', action: 'url', value: '' }] })}>ボタンを追加</button>
      <p className={styles.muted}>フォームとシナリオは、配り先にある同じ名前のものにつなぎます。見つからない場合は配る前にお知らせします。</p>
    </>}
  </div>
}

function MessageEditor({ value, disabled, onChange, onBusyChange, onReceipt }: { value: MessageTemplateDefinition; disabled: boolean; onChange: (next: MessageTemplateDefinition) => void; onBusyChange?: (busy: boolean) => void; onReceipt?: (media: MessageTemplateDefinition['media'][number]) => void }) {
  const theme = useAdminTheme()
  const current = value.template
  const [targetDate, setTargetDate] = useState('')
  const [advanced, setAdvanced] = useState(false)
  if (theme === 'v8' && (value.card || (!advanced && current.id === 'hq-authored-message' && current.messageType === 'text' && !current.carouselActionsJson && !current.questionJson))) return <>
    <CardEditor value={value} disabled={disabled} onChange={onChange} onBusyChange={onBusyChange} onReceipt={onReceipt} />
    {!value.card && <button type="button" disabled={disabled} onClick={() => setAdvanced(true)}>画像・カルーセルの詳細編集を使う</button>}
  </>
  const messageTypeOptions = [
    { value: 'text', label: 'テキスト' },
    { value: 'flex', label: 'カード型' },
    { value: 'image', label: '画像' },
    // 既存データを開いて保存しても形式を落とさない。アカウント側の専用編集画面へ
    // 移されるまで、HQで作成済みのカルーセルも選択肢として保持する。
    { value: 'carousel', label: 'カルーセル' },
  ]
  const legacyDisabled = disabled || Boolean(value.card)
  return (<>
    {theme === 'v7' && value.card && <p role="status">タイトルとボタンをまとめて作ったひな形は、設定の「画面の見た目（試作）」をV8に切り替えて編集してください。</p>}
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
      referenceUnavailableHint="友だち情報と共通情報はアカウントごとに異なるため、配布先のLINEアカウントで設定してください。"
      disabled={legacyDisabled}
      typeOptions={messageTypeOptions}
      bodyAriaLabel="配信する本文"
      beforeType={(
        <>
          <label className={styles.field}>
            <span>分類</span>
            <input aria-label="テンプレートの分類" className={styles.input} value={current.category} maxLength={100} disabled={legacyDisabled} onChange={event => onChange({ ...value, template: { ...current, category: event.target.value } })} />
          </label>
          {current.id === 'hq-authored-message' && <ImageUpload purpose="message" disabled={legacyDisabled} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={media => onChange(withUploadedImage(value, media))} />}
          {value.media.map(media => <p key={media.id} className={styles.muted}>{media.filename}（{Math.ceil(media.sizeBytes / 1024)} KB）<br /><span className={styles.name}>{media.publicUrl ?? media.r2Key}</span></p>)}
        </>
      )}
    />
  </>)
}

export type RichMenuEditorReferences = {
  tags?: RichMenuOption[]
  templates?: RichMenuOption[]
  forms?: RichMenuOption[]
  trackedLinks?: RichMenuOption[]
}

function RichMenuEditor({ value, disabled, onChange, onBusyChange, onNameChange, onReceipt, references = {} }: { value: RichMenuDefinition; disabled: boolean; tenantId?: string; onChange: (next: RichMenuDefinition) => void; onBusyChange?: (busy: boolean) => void; onNameChange?: (name: string) => void; onReceipt?: (media: MessageTemplateDefinition['media'][number]) => void; references?: RichMenuEditorReferences }) {
  const [changeError, setChangeError] = useState<string | null>(null)
  let compatibilityError: string | null = null
  let draft = freshRichMenuCreateValue()
  try { draft = hqDefinitionToRichMenuCreateValue(value) }
  catch (error) { compatibilityError = error instanceof Error ? error.message : '内容を安全に読み込めないため停止しました。' }
  const page = value.richMenu.pages[0]
  // R568: 今の大きさで採用できる寸法。合わない画像は送る前に止める。
  const expectedSize = value.richMenu.size === 'large' ? { width: 2500, height: 1686 } : { width: 2500, height: 843 }
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
    imageAction={page ? <ImageUpload purpose="rich_menu" disabled={disabled || Boolean(compatibilityError)} expectedSize={expectedSize} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={media => {
      if (media.width !== 2500 || media.height !== (value.richMenu.size === 'large' ? 1686 : 843)) throw new Error('選択中のサイズに合う画像を指定してください。')
      onChange({ ...value, richMenu: { ...value.richMenu, pages: [{ ...page, imageR2Key: media.r2Key }, ...value.richMenu.pages.slice(1)] } })
    }} /> : null}
  />
}

export default function TemplateDefinitionEditor({ type, value, disabled, editing = false, tenantId, onChange, onBusyChange, onMediaUploaded, richMenuReferences, formReferences, onRichMenuNameChange, onCanonicalSave, onCanonicalCancel }: { type: TemplateType; value: TemplateDefinition; disabled: boolean; editing?: boolean; tenantId?: string; onChange: (next: TemplateDefinition) => void; onBusyChange?: (busy: boolean) => void; onMediaUploaded?: (media: MessageTemplateDefinition['media'][number]) => void; richMenuReferences?: RichMenuEditorReferences; formReferences?: FormRefs; onRichMenuNameChange?: (name: string) => void; onCanonicalSave?: (definition: TagDefinition | FormDefinition, andAnother?: boolean) => void | Promise<void>; onCanonicalCancel?: () => void }) {
  if (type === 'scenario' && 'scenario' in value) return <div className={styles.stack}>{value.steps.map((step,index)=><section key={step.id} className={styles.panel}><h2>ステップ{index+1}</h2><label className={styles.field}>前のステップからの遅延（分）<input type="number" min={0} max={525600} aria-label={`ステップ${index+1}の遅延`} disabled={disabled} value={step.delayMinutes} onChange={e=>onChange({...value,steps:value.steps.map(s=>s.id===step.id?{...s,delayMinutes:Number(e.target.value)}:s)})}/></label><label className={styles.field}>形式<select disabled={disabled} value={step.messageType} onChange={e=>onChange({...value,steps:value.steps.map(s=>s.id===step.id?{...s,messageType:e.target.value as 'text'|'flex'}:s)})}><option value="text">テキスト</option><option value="flex">カード型</option></select></label><label className={styles.field}>本文<textarea className={styles.textarea} aria-label={`ステップ${index+1}の本文`} disabled={disabled} value={step.messageContent} onChange={e=>onChange({...value,steps:value.steps.map(s=>s.id===step.id?{...s,messageContent:e.target.value}:s)})}/></label><button type="button" disabled={disabled||value.steps.length===1} onClick={()=>onChange({...value,steps:value.steps.filter(s=>s.id!==step.id)})}>このステップを外す</button></section>)}<button type="button" disabled={disabled||value.steps.length>=100} onClick={()=>onChange({...value,steps:[...value.steps,{id:crypto.randomUUID(),delayMinutes:0,messageType:'text',messageContent:''}]})}>ステップを追加</button><p>配布先では停止中の下書きになります。内容を確認して公開してください。</p></div>
  if (type === 'tag' && 'tag' in value) return <HqTagDefinitionEditor definition={value} mode={editing ? 'edit' : 'create'} saving={disabled} onCancel={onCanonicalCancel ?? (() => undefined)} onSave={async (next, andAnother) => { onChange(next); await onCanonicalSave?.(next, andAnother) }} />
  if (type === 'template' && 'template' in value) return <MessageEditor value={value} disabled={disabled} onChange={onChange} onBusyChange={onBusyChange} onReceipt={onMediaUploaded} />
  if (type === 'rich_menu' && 'richMenu' in value) return <RichMenuEditor value={value} disabled={disabled} tenantId={tenantId} onChange={onChange} onBusyChange={onBusyChange} onNameChange={onRichMenuNameChange} onReceipt={onMediaUploaded} references={richMenuReferences} />
  if (type === 'form' && 'form' in value) return <HqFormDefinitionEditor definition={value} refs={formReferences} saving={disabled} onCancel={onCanonicalCancel ?? (() => undefined)} onSave={async next => { onChange(next); await onCanonicalSave?.(next) }} />
  return <p role="alert">ひな形の種類と保存内容が一致しません。</p>
}
