'use client'

import SelectField from '@/components/shared/select-field'
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import {
  listInterpolations,
  type CommonVar,
  type Folder,
  type FriendField,
} from '@line-crm/shared'
import { Field, inputClass } from '@/components/shared/create-page'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import TemplateAssetEditor from '../template-asset-editor'

const TYPES = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'カード型' },
  { value: 'image', label: '画像' },
]

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

type ReferenceState = 'idle' | 'loading' | 'ready' | 'failed'

interface TemplateReferences {
  friendFields: FriendField[]
  commonVars: CommonVar[]
}

interface ReferenceLoaders {
  friendFields: (accountId: string) => ReturnType<typeof api.friendFields.list>
  commonVars: (accountId: string) => ReturnType<typeof api.commonVars.list>
}

async function loadTemplateReferences(
  accountId: string,
  loaders: ReferenceLoaders = {
    friendFields: (id) => api.friendFields.list(id),
    commonVars: (id) => api.commonVars.list(id),
  },
): Promise<TemplateReferences> {
  const [fieldResponse, varResponse] = await Promise.all([
    loaders.friendFields(accountId),
    loaders.commonVars(accountId),
  ])
  if (!fieldResponse.success || !varResponse.success) {
    throw new Error('差し込み項目を読み込めませんでした')
  }
  return {
    friendFields: fieldResponse.data.filter((field) => field.canInsertText !== false),
    commonVars: varResponse.data,
  }
}

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

function previewDateValue(name: string, deliveredAt: Date): string | null {
  const daysUntil = /^days_until:(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (daysUntil) {
    const current = jstDateParts(deliveredAt)
    const currentDay = Date.UTC(current.year, current.month - 1, current.day)
    const targetDay = Date.UTC(Number(daysUntil[1]), Number(daysUntil[2]) - 1, Number(daysUntil[3]))
    return String(Math.ceil((targetDay - currentDay) / 86_400_000))
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

interface TemplatePreviewResult {
  content: string
  unresolved: string[]
}

function buildTemplatePreview(
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

  // 括弧の書きかけなど、置換用の正規表現に入らないものも一覧へ残す。
  for (const name of listInterpolations(content)) {
    if (preview.includes(`{{${name}}}`)) unresolved.add(name)
  }
  return { content: preview, unresolved: [...unresolved] }
}

function extractMessageUrls(content: string): string[] {
  return [...new Set(content.match(/https?:\/\/[^\s<>"'）)]+/g) ?? [])]
}

interface InsertControlsProps extends TemplateReferences {
  accountId: string | null
  state: ReferenceState
  onInsert: (token: string) => void
}

function TemplateInsertControls({
  accountId,
  state,
  friendFields,
  commonVars,
  onInsert,
}: InsertControlsProps) {
  const [targetDate, setTargetDate] = useState('')
  const choose = (value: string) => {
    if (value) onInsert(value)
  }
  return (
    <div aria-label="利用できる差し込み項目" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onInsert('{{name}}')}
          className="border-hairline text-ink-secondary rounded-pill hover:bg-canvas-sunken border px-3 py-1 text-xs"
        >
          名前
        </button>
        <SelectField
          aria-label="友だち情報を差し込む"
          value=""
          disabled={!accountId || state !== 'ready' || friendFields.length === 0}
          onChange={(event) => choose(event.target.value)}
          options={[
            { value: '', label: state === 'loading' ? '友だち情報を読込中' : '友だち情報を選ぶ' },
            ...friendFields.map((field) => ({ value: `{{field.${field.fieldKey}}}`, label: field.name })),
          ]}
        />
        <SelectField
          aria-label="共通情報を差し込む"
          value=""
          disabled={!accountId || state !== 'ready' || commonVars.length === 0}
          onChange={(event) => choose(event.target.value)}
          options={[
            { value: '', label: state === 'loading' ? '共通情報を読込中' : '共通情報を選ぶ' },
            ...commonVars.map((item) => ({ value: `{{var.${item.varKey}}}`, label: item.name })),
          ]}
        />
        <SelectField
          aria-label="配信日を差し込む"
          value=""
          onChange={(event) => choose(event.target.value)}
          options={[{ value: '', label: '配信日を選ぶ' }, ...DATE_OPTIONS]}
        />
        <SelectField
          aria-label="その他の差し込みを選ぶ"
          value=""
          onChange={(event) => choose(event.target.value)}
          options={[{ value: '', label: 'その他を選ぶ' }, ...OTHER_OPTIONS]}
        />
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          目標日
          <input
            aria-label="日数を数える目標日"
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className="border-hairline rounded-control border bg-canvas px-2 py-1 text-xs text-ink"
          />
        </label>
        <button
          type="button"
          disabled={!targetDate}
          onClick={() => onInsert(`{{days_until:${targetDate}}}`)}
          className="border-hairline text-ink-secondary rounded-pill hover:bg-canvas-sunken border px-3 py-1 text-xs disabled:opacity-40"
        >
          目標日までの日数
        </button>
      </div>
      <p className="text-ink-faint text-xs">
        フォーム回答は直接差し込めません。回答を保存した友だち情報を選んでください。
      </p>
      {!accountId && (
        <p className="text-ink-faint text-xs">LINE公式アカウントを選ぶと、友だち情報と共通情報を選べます。</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="text-danger text-xs">差し込み項目を読み込めませんでした。画面を再読み込みしてください。</p>
      )}
    </div>
  )
}

function TemplatePreviewMessage({ preview }: { preview: TemplatePreviewResult }) {
  return (
    <>
      <p className="text-ink rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
        {preview.content || '（本文がまだありません）'}
      </p>
      {preview.unresolved.length > 0 && (
        <div role="alert" className="mt-2 rounded-control bg-canvas px-3 py-2 text-xs text-danger">
          <p className="font-semibold">値を確認できない差し込みがあります</p>
          <ul className="mt-1 list-disc pl-4">
            {preview.unresolved.map((name) => <li key={name}>{`{{${name}}}`}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}

function TemplateEditInner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const assetKind = params.get('kind')
  const visual = params.get('visual') === '1'
  usePageTitle(id ? 'メッセージを編集' : 'メッセージを作る')

  const [name, setName] = useState(visual ? '定期便 初回のご案内' : '')
  // category は旧一覧との互換用に保存だけ続ける。運用者が選ぶ分類は folderId に一本化する。
  const [category, setCategory] = useState('general')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [references, setReferences] = useState<TemplateReferences>({ friendFields: [], commonVars: [] })
  const [referenceState, setReferenceState] = useState<ReferenceState>('idle')
  const [messageType, setMessageType] = useState('text')
  const [messageContent, setMessageContent] = useState(
    visual
      ? '{{name}}さん、いつもありがとうございます。\n初回のお届け予定はこちらです。\nhttps://example.co.jp/first-delivery'
      : '',
  )
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 読み込めていない本文のまま保存すると、空で上書きする危険がある。
  const [loadFailed, setLoadFailed] = useState(false)

  // 置き場の選択肢。category 文字列とは別に folderId で保存する。
  useEffect(() => {
    let cancelled = false
    void api.folders.list('template')
      .then((res) => {
        if (!cancelled && res.success) setFolders(res.data)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setReferences({ friendFields: [], commonVars: [] })
    if (!selectedAccountId) {
      setReferenceState('idle')
      return () => { cancelled = true }
    }

    setReferenceState('loading')
    void loadTemplateReferences(selectedAccountId)
      .then((next) => {
        if (!cancelled) {
          setReferences(next)
          setReferenceState('ready')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReferences({ friendFields: [], commonVars: [] })
          setReferenceState('failed')
        }
      })
    return () => { cancelled = true }
  }, [selectedAccountId])

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (res.success) {
          setName(res.data.name)
          setCategory(res.data.category ?? '')
          setFolderId(res.data.folderId ?? null)
          setMessageType(res.data.messageType)
          setMessageContent(res.data.messageContent)
        } else {
          setLoadFailed(true)
          setError('読み込めませんでした。開き直してください。')
        }
      })
      .catch(() => {
        setLoadFailed(true)
        setError('読み込めませんでした。開き直してください。')
      })
      .finally(() => setLoading(false))
  }, [id])

  const contentRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * 差し込みをカーソル位置に入れる。
   *
   * 末尾に足すだけだと、書いている途中の文の真ん中に入れられない。
   * 差し込みは文中に置くことがほとんどなので、位置を見て入れる。
   */
  const insert = (token: string) => {
    const el = contentRef.current
    if (!el) {
      setMessageContent((v) => v + token)
      return
    }
    const start = el.selectionStart ?? messageContent.length
    const end = el.selectionEnd ?? start
    const next = messageContent.slice(0, start) + token + messageContent.slice(end)
    setMessageContent(next)
    // 入れた直後にカーソルを token の後ろへ。続けて書けるようにする。
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  // LINE は約4,500文字で分割される。上限そのものではないので、超えても
  // 保存はできる。何通に分かれるかだけ伝える。
  const SPLIT_AT = 4500
  const willSplit = messageContent.length > SPLIT_AT
  const preview = buildTemplatePreview(messageContent, references)
  const messageUrls = extractMessageUrls(messageContent)

  const save = async () => {
    if (loadFailed) {
      setError('読み込めませんでした。開き直してください。')
      return
    }
    if (!id && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (!messageContent.trim()) {
      setError('本文を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = id
        ? await api.templates.update(id, { name: name.trim(), category, messageType, messageContent, folderId })
        : await api.templates.create({
            accountId: selectedAccountId!,
            name: name.trim(),
            category,
            messageType,
            messageContent,
            folderId,
          })
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/templates')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (assetKind === 'rich_message' || assetKind === 'coupon' || assetKind === 'research') {
    return <TemplateAssetEditor kind={assetKind} visual={visual} />
  }

  return (
    <div aria-label="テンプレート編集">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || (id ? '編集' : '作成')}</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
        <div data-design="Left" className="bg-canvas rounded-card border-hairline min-w-0 flex-1 space-y-5 border p-6">
          <Field label="テンプレート名" htmlFor="tp-name" required>
            <input
              id="tp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="置き場" htmlFor="tp-folder" note="一覧のフォルダ分けと絞り込みに使います。">
            <SelectField
              id="tp-folder"
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
            />
          </Field>

          <Field
            label="種類"
            htmlFor="tp-type"
            note={
              id ? '作ったあとに種類を変えると、中身の書き方も変える必要があります。' : undefined
            }
          >
            <SelectField
              id="tp-type"
              value={messageType}
              onChange={(e) => setMessageType(e.target.value)}
              options={TYPES.map((t) => ({ value: t.value, label: t.label }))}
              className={inputClass}
            />
          </Field>

          <div>
            <p className="text-ink-secondary mb-1 text-sm font-medium">差し込む</p>
            <TemplateInsertControls
              accountId={selectedAccountId}
              state={referenceState}
              friendFields={references.friendFields}
              commonVars={references.commonVars}
              onInsert={insert}
            />
          </div>

          <Field
            label="本文"
            htmlFor="tp-content"
            required
            note={
              <>
                差し込みは上の選択肢から入れられます。名前と友だち情報は受け取る人ごと、
                共通情報と配信日は送る時点の値に置き換わります。
                <br />
                カルーセルを作るときは{' '}
                <Link href="/templates/carousel" className="text-accent hover:underline">
                  カルーセルの編集
                </Link>{' '}
                を使ってください。
              </>
            }
          >
            <textarea
              id="tp-content"
              ref={contentRef}
              rows={messageType === 'flex' ? 14 : 6}
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              className={`${inputClass} resize-y ${messageType === 'flex' ? 'font-mono text-xs' : ''}`}
            />
            <p className="text-ink-faint mt-1 text-xs tabular-nums">
              {messageContent.length} 文字
              {willSplit
                ? ` ・ 約${SPLIT_AT}文字を超えると複数のメッセージに分割されます`
                : ' ・ 分割なし'}
            </p>
          </Field>

          <section aria-label="本文内のURL" className="border-hairline rounded-card border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-ink text-sm font-semibold">本文に入れたURLの扱い</p>
              <span className="text-accent-deep text-xs font-semibold">短縮して、クリックを数える</span>
            </div>
            {/* テンプレートの本文と短縮URLを結ぶ記録が無い。配信時に短縮
                されるが、テンプレート単位のクリック数は追えない。 */}
            <div className="border-hairline mt-3 overflow-hidden rounded-control border text-xs">
              <div className="bg-canvas-sunken grid grid-cols-3 gap-3 px-3 py-2 font-semibold text-ink-secondary">
                <span>本文の中のURL</span><span>リンク名（計測に出る名前）</span><span>流入リンクにする</span>
              </div>
              {messageUrls.length === 0 ? (
                <p className="text-ink-faint px-3 py-3">本文にURLはありません。</p>
              ) : messageUrls.map((url) => (
                <div key={url} className="grid grid-cols-3 gap-3 px-3 py-3 text-ink">
                  <span className="truncate" title={url}>{url}</span>
                  <span className="text-ink-faint">配信時に自動作成</span>
                  <span className="text-ink-faint">配信時に自動発行</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border-hairline rounded-card border p-4">
            <p className="text-ink text-sm font-semibold">送信時のアイコン・表示名</p>
            {/* 担当者名義で送る仕組みが無い。送信元は常に公式アカウント。 */}
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              いまは公式アイコンでの送信だけです。担当者名義での送信は準備中です。
            </p>
          </section>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || loadFailed}
              className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              disabled
              title="テスト送信は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
            >
              テスト送信
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
        </div>

        <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-96">
          <section className="bg-line-preview rounded-card border-hairline border p-4">
            <p className="text-on-accent text-center text-sm font-semibold">LINEプレビュー</p>
            <p className="text-on-accent mx-auto mt-2 mb-2 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">差し込み後の見え方（山田 太郎さんの場合）</p>
            <div className="bg-canvas-sunken rounded-card mt-3 p-3">
              <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
              <TemplatePreviewMessage preview={preview} />
            </div>
            <p className="text-on-accent mt-2 text-xs leading-relaxed">
              名前は山田 太郎さん、友だち情報は項目の既定値、共通情報は現在値で表示しています。
            </p>
            <p className="text-on-accent mt-1 text-xs">URLは短縮され、クリックが計測されます</p>
          </section>
        </div>
        </div>
      )}
    </div>
  )
}

export default function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditInner />
    </Suspense>
  )
}
