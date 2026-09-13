'use client'

import Link from 'next/link'
import { useRef, type ReactNode } from 'react'
import { listInterpolations, type CommonVar, type FriendField } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { Field, TextArea } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'

export const MESSAGE_TEMPLATE_TYPES = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'カード型' },
  { value: 'image', label: '画像' },
] as const

const DATE_OPTIONS = [
  { value: '{{date}}', label: '月日と曜日（8月20日(水)）' },
  { value: '{{date:ymd_w}}', label: '年月日と曜日（2026年8月20日(水)）' },
  { value: '{{date:md}}', label: '月日（8月20日）' },
  { value: '{{date:ymd}}', label: '年月日（2026年8月20日）' },
  { value: '{{date:slash_md_w}}', label: '月日と曜日（8/20(水)）' },
  { value: '{{date:slash_ymd_w}}', label: '年月日と曜日（2026/8/20(水)）' },
  { value: '{{date:slash_md}}', label: '月日（8/20）' },
  { value: '{{date:slash_ymd}}', label: '年月日（2026/8/20）' },
]

const OTHER_OPTIONS = [
  { value: '{{liff_id}}', label: 'LIFF ID' },
  { value: '{{date+1}}', label: '配信日の1日後' },
  { value: '{{date+3}}', label: '配信日の3日後' },
  { value: '{{date+7}}', label: '配信日の7日後' },
  { value: '{{date+14}}', label: '配信日の14日後' },
  { value: '{{date+30}}', label: '配信日の30日後' },
]

export type TemplateReferenceState = 'idle' | 'loading' | 'ready' | 'failed'

export interface TemplateReferences {
  friendFields: FriendField[]
  commonVars: CommonVar[]
}

export const EMPTY_TEMPLATE_REFERENCES: TemplateReferences = { friendFields: [], commonVars: [] }

function jstDateParts(date: Date): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: value('weekday'),
  }
}

export function previewDateValue(name: string, deliveredAt: Date): string | null {
  const daysUntil = /^days_until:(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (daysUntil) {
    const current = jstDateParts(deliveredAt)
    const currentDay = Date.UTC(current.year, current.month - 1, current.day)
    const targetDay = Date.UTC(Number(daysUntil[1]), Number(daysUntil[2]) - 1, Number(daysUntil[3]))
    return String(Math.max(0, Math.round((targetDay - currentDay) / 86_400_000)))
  }

  const dateToken = /^date(?:([+-])(\d+))?(?::([a-z_]+))?$/.exec(name)
  if (!dateToken) return null
  const direction = dateToken[1] === '-' ? -1 : 1
  const offset = Number(dateToken[2] ?? 0) * direction
  const parts = jstDateParts(new Date(deliveredAt.getTime() + offset * 86_400_000))
  const format = dateToken[3] ?? 'md_w'
  const ymd = `${parts.year}年${parts.month}月${parts.day}日`
  const md = `${parts.month}月${parts.day}日`
  const slashYmd = `${parts.year}/${parts.month}/${parts.day}`
  const slashMd = `${parts.month}/${parts.day}`
  switch (format) {
    case 'ymd_w': return `${ymd}(${parts.weekday})`
    case 'ymd': return ymd
    case 'md': return md
    case 'slash_ymd_w': return `${slashYmd}(${parts.weekday})`
    case 'slash_ymd': return slashYmd
    case 'slash_md_w': return `${slashMd}(${parts.weekday})`
    case 'slash_md': return slashMd
    default: return `${md}(${parts.weekday})`
  }
}

export interface TemplatePreviewResult {
  content: string
  unresolved: string[]
}

export function buildTemplatePreview(
  content: string,
  references: TemplateReferences,
  deliveredAt = new Date(),
): TemplatePreviewResult {
  const fields = new Map(references.friendFields.map((field) => [field.fieldKey, field]))
  const commonVars = new Map(references.commonVars.map((item) => [item.varKey, item]))
  const unresolved = new Set<string>()
  const interpolation = /\{\{\s*([^{}]+?)\s*\}\}/g

  const preview = content.replace(interpolation, (token, rawName: string) => {
    const name = rawName.trim()
    if (name === 'name') return '山田 太郎'
    if (name === 'liff_id') return '［LIFF ID］'

    const fieldKey = /^field\.([a-z][a-z0-9_]*)$/.exec(name)?.[1]
    if (fieldKey) {
      const field = fields.get(fieldKey)
      if (!field) {
        unresolved.add(name)
        return token
      }
      return field.defaultValue?.trim() || `［${field.name}の値］`
    }

    const varKey = /^var\.([a-z][a-z0-9_]*)$/.exec(name)?.[1]
    if (varKey) {
      const commonVar = commonVars.get(varKey)
      if (!commonVar) {
        unresolved.add(name)
        return token
      }
      return commonVar.value || `［${commonVar.name}は空です］`
    }

    const dateValue = previewDateValue(name, deliveredAt)
    if (dateValue !== null) return dateValue
    unresolved.add(name)
    return token
  })

  for (const name of listInterpolations(content)) {
    if (preview.includes(`{{${name}}}`)) unresolved.add(name)
  }
  return { content: preview, unresolved: [...unresolved] }
}

export function extractMessageUrls(content: string): string[] {
  return [...new Set(content.match(/https?:\/\/[^\s<>"'）)]+/g) ?? [])]
}

interface InsertControlsProps extends TemplateReferences {
  accountId: string | null
  state: TemplateReferenceState
  accountLabel?: string | null
  targetDate: string
  disabled?: boolean
  unavailableHint?: ReactNode
  onTargetDateChange: (value: string) => void
  onInsert: (token: string) => void
}

export function TemplateInsertControls({
  accountId,
  state,
  accountLabel,
  targetDate,
  disabled = false,
  unavailableHint,
  onTargetDateChange,
  friendFields,
  commonVars,
  onInsert,
}: InsertControlsProps) {
  const choose = (value: string) => {
    if (value) onInsert(value)
  }
  return (
    <div aria-label="利用できる差し込み項目" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="field" disabled={disabled} onClick={() => onInsert('{{name}}')}>名前</Button>
        <SelectField aria-label="友だち情報を差し込む" value="" disabled={disabled || !accountId || state !== 'ready' || friendFields.length === 0} onChange={(event) => choose(event.target.value)} options={[{ value: '', label: state === 'loading' ? '友だち情報を読込中' : '友だち情報を選ぶ' }, ...friendFields.map((field) => ({ value: `{{field.${field.fieldKey}}}`, label: field.name }))]} />
        <SelectField aria-label="共通情報を差し込む" value="" disabled={disabled || !accountId || state !== 'ready' || commonVars.length === 0} onChange={(event) => choose(event.target.value)} options={[{ value: '', label: state === 'loading' ? '共通情報を読込中' : '共通情報を選ぶ' }, ...commonVars.map((item) => ({ value: `{{var.${item.varKey}}}`, label: item.name }))]} />
        <SelectField aria-label="配信日を差し込む" value="" disabled={disabled} onChange={(event) => choose(event.target.value)} options={[{ value: '', label: '配信日を選ぶ' }, ...DATE_OPTIONS]} />
        <SelectField aria-label="その他の差し込みを選ぶ" value="" disabled={disabled} onChange={(event) => choose(event.target.value)} options={[{ value: '', label: 'その他を選ぶ' }, ...OTHER_OPTIONS]} />
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          目標日
          <input aria-label="日数を数える目標日" type="date" value={targetDate} disabled={disabled} onChange={(event) => onTargetDateChange(event.target.value)} className="border-hairline rounded-control border bg-canvas px-2 py-1 text-xs text-ink disabled:opacity-40" />
        </label>
        <Button size="field" disabled={disabled || !targetDate} onClick={() => onInsert(`{{days_until:${targetDate}}`)}>目標日までの日数</Button>
      </div>
      <p className="text-ink-faint text-xs">フォーム回答は直接差し込めません。回答を保存した友だち情報を選んでください。</p>
      {accountLabel && <p className="text-ink-faint text-xs">候補は「{accountLabel}」の友だち情報と共通情報です。</p>}
      {!accountId && <p className="text-ink-faint text-xs">{unavailableHint ?? 'LINE公式アカウントを選ぶと、友だち情報と共通情報を選べます。'}</p>}
      {state === 'failed' && <p role="alert" className="text-danger text-xs">差し込み項目を読み込めませんでした。画面を再読み込みしてください。</p>}
    </div>
  )
}

export function TemplatePreviewMessage({ preview }: { preview: TemplatePreviewResult }) {
  return (
    <>
      <p className="text-ink rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap">{preview.content || '（本文がまだありません）'}</p>
      {preview.unresolved.length > 0 && (
        <div role="alert" className="mt-2 rounded-control bg-canvas px-3 py-2 text-xs text-danger">
          <p className="font-semibold">値を確認できない差し込みがあります</p>
          <ul className="mt-1 list-disc pl-4">{preview.unresolved.map((name) => <li key={name}>{`{{${name}}}`}</li>)}</ul>
        </div>
      )}
    </>
  )
}

export interface MessageTemplateEditorValue {
  messageType: string
  messageContent: string
}

export function MessageTemplateEditor({
  value,
  onChange,
  targetDate,
  onTargetDateChange,
  references = EMPTY_TEMPLATE_REFERENCES,
  referenceState = 'idle',
  referenceAccountId = null,
  referenceAccountLabel,
  referenceUnavailableHint,
  disabled = false,
  typeOptions = MESSAGE_TEMPLATE_TYPES,
  typeNote,
  bodyLabel,
  bodyAriaLabel,
  carouselHref,
  beforeType,
  afterType,
  footer,
}: {
  value: MessageTemplateEditorValue
  onChange: (next: MessageTemplateEditorValue) => void
  targetDate: string
  onTargetDateChange: (value: string) => void
  references?: TemplateReferences
  referenceState?: TemplateReferenceState
  referenceAccountId?: string | null
  referenceAccountLabel?: string | null
  referenceUnavailableHint?: ReactNode
  disabled?: boolean
  typeOptions?: ReadonlyArray<{ value: string; label: string }>
  typeNote?: ReactNode
  bodyLabel?: string
  bodyAriaLabel?: string
  carouselHref?: string
  beforeType?: ReactNode
  afterType?: ReactNode
  footer?: ReactNode
}) {
  const contentRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = (token: string) => {
    const element = contentRef.current
    const start = element?.selectionStart ?? value.messageContent.length
    const end = element?.selectionEnd ?? start
    const messageContent = value.messageContent.slice(0, start) + token + value.messageContent.slice(end)
    onChange({ ...value, messageContent })
    if (element) requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const splitAt = 4500
  const preview = buildTemplatePreview(value.messageContent, references)
  const messageUrls = extractMessageUrls(value.messageContent)
  const contentLabel = bodyLabel ?? (value.messageType === 'text' ? '本文' : 'メッセージ内容')

  return (
    <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
      <div data-design="Left" className="bg-canvas rounded-card border-hairline min-w-0 flex-1 space-y-5 border p-6">
        {beforeType}
        <Field label="種類" htmlFor="tp-type" note={typeNote}>
          <SelectField id="tp-type" aria-label="メッセージ形式" value={value.messageType} disabled={disabled} onChange={(event) => onChange({ ...value, messageType: event.target.value })} options={[...typeOptions]} />
        </Field>
        {afterType}
        <div>
          <p className="text-ink-secondary mb-1 text-sm font-medium">差し込む</p>
          <TemplateInsertControls accountId={referenceAccountId} state={referenceState} accountLabel={referenceAccountLabel} targetDate={targetDate} disabled={disabled} unavailableHint={referenceUnavailableHint} onTargetDateChange={onTargetDateChange} friendFields={references.friendFields} commonVars={references.commonVars} onInsert={insert} />
        </div>
        <Field
          label={contentLabel}
          htmlFor="tp-content"
          required
          note={<>
            差し込みは上の選択肢から入れられます。名前と友だち情報は受け取る人ごと、共通情報と配信日は送る時点の値に置き換わります。
            {carouselHref && <><br />カルーセルを作るときは <Link href={carouselHref} className="text-accent hover:underline">カルーセルの編集</Link> を使ってください。</>}
          </>}
        >
          {value.messageType === 'flex' ? (
            <TextArea id="tp-content" aria-label={bodyAriaLabel} ref={contentRef} rows={14} value={value.messageContent} disabled={disabled} onChange={(event) => onChange({ ...value, messageContent: event.target.value })} className="resize-y font-mono text-xs" />
          ) : (
            <TextArea id="tp-content" aria-label={bodyAriaLabel} ref={contentRef} rows={6} value={value.messageContent} disabled={disabled} onChange={(event) => onChange({ ...value, messageContent: event.target.value })} className="resize-y" />
          )}
          <p className="text-ink-faint mt-1 text-xs tabular-nums">{value.messageContent.length} 文字{value.messageContent.length > splitAt ? ` ・ 約${splitAt}文字を超えると複数のメッセージに分割されます` : ' ・ 分割なし'}</p>
        </Field>
        <section aria-label="本文内のURL" className="border-hairline rounded-card border p-4">
          <div className="flex items-center justify-between gap-3"><p className="text-ink text-sm font-semibold">本文に入れたURLの扱い</p><span className="text-accent-deep text-xs font-semibold">短縮して、クリックを数える</span></div>
          <div className="border-hairline mt-3 overflow-hidden rounded-control border text-xs">
            <div className="bg-canvas-sunken grid grid-cols-3 gap-3 px-3 py-2 font-semibold text-ink-secondary"><span>本文の中のURL</span><span>リンク名（計測に出る名前）</span><span>流入リンクにする</span></div>
            {messageUrls.length === 0 ? <p className="text-ink-faint px-3 py-3">本文にURLはありません。</p> : messageUrls.map((url) => <div key={url} className="grid grid-cols-3 gap-3 px-3 py-3 text-ink"><span className="truncate" title={url}>{url}</span><span className="text-ink-faint">配信時に自動作成</span><span className="text-ink-faint">配信時に自動発行</span></div>)}
          </div>
        </section>
        <section className="border-hairline rounded-card border p-4"><p className="text-ink text-sm font-semibold">送信時のアイコン・表示名</p><p className="text-ink-faint mt-1 text-xs leading-relaxed">公式アイコンと表示名で送信します。担当者名義で送ることはできません。</p></section>
        {footer}
      </div>
      <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-96">
        <section className="bg-line-preview rounded-card border-hairline border p-4">
          <p className="text-on-accent text-center text-sm font-semibold">LINEプレビュー</p>
          <p className="text-on-accent mx-auto mt-2 mb-2 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">差し込み後の見え方（山田 太郎さんの場合）</p>
          <div className="bg-canvas-sunken rounded-card mt-3 p-3"><p className="text-ink-faint mb-1 text-xs">然-NEN-</p><TemplatePreviewMessage preview={preview} /></div>
          <p className="text-on-accent mt-2 text-xs leading-relaxed">名前は山田 太郎さん、友だち情報は項目の既定値、共通情報は現在値で表示しています。</p>
          <p className="text-on-accent mt-1 text-xs">URLは短縮され、クリックが計測されます</p>
        </section>
      </div>
    </div>
  )
}
