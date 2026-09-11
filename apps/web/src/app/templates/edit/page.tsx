'use client'

import SelectField from '@/components/shared/select-field'
import React, { Suspense, useEffect, useRef, useState } from 'react'
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

const EMPTY_REFERENCES: TemplateReferences = { friendFields: [], commonVars: [] }

/**
 * 編集画面が見ている LINE 公式アカウントの組み合わせ。
 *
 * 「上のバーで選んでいるもの」と「開いているテンプレートの所属」は別物。
 * この2つを1つの変数で扱うと、切り替えた瞬間に取り違える。
 */
interface TemplateAccountBinding {
  templateId: string | null
  /**
   * **いま画面にある中身が、その `templateId` のものとして確定しているか。**
   *
   * `ready` 以外は、所属アカウントも本文も、この id のものだと言えない。
   * URL の id を A から B へ替えた直後がまさにそれで、画面には A の本文が
   * 残ったまま送り先だけ B になっている。
   */
  templateStatus: TemplateLoadStatus
  templateAccountId: string | null
  selectedAccountId: string | null
}

type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

const ACCOUNT_MISMATCH_MESSAGE =
  '別のLINE公式アカウントに切り替わっています。上のバーでこのテンプレートのアカウントへ戻すと保存できます。'

const TEMPLATE_LOAD_FAILED_MESSAGE = '読み込めませんでした。開き直してください。'

const TEMPLATE_LOADING_MESSAGE =
  'テンプレートを読み込んでいます。読み終わるまで保存できません。'

/**
 * 差し込み候補を読むアカウント。**既存テンプレートは所属へ固定する。**
 *
 * 上のバーで A から B へ替えても、A のテンプレートを開いている限り
 * 候補は A のまま。替えた先の候補を出すと、A のテンプレートへ B の
 * 項目キーを書き込める。書き込めても A の友だちにその項目は無いので、
 * 配信時に `{{field.…}}` が置き換わらないまま相手へ届く。
 *
 * 取得が終わるまでは `null`。終わる前に選択中アカウントで読むと、
 * 一瞬だけ別アカウントの候補が並び、その隙に選べてしまう。
 */
function resolveEditorAccountId(binding: TemplateAccountBinding): string | null {
  if (!binding.templateId) return binding.selectedAccountId
  if (binding.templateStatus !== 'ready') return null
  // 所属を持たない旧データだけ、選択中アカウントの候補で編集する。
  return binding.templateAccountId ?? binding.selectedAccountId
}

/** 開いているテンプレートの所属と、上のバーの選択が食い違っているか。 */
function templateAccountMismatch(binding: TemplateAccountBinding): boolean {
  if (!binding.templateId || binding.templateStatus !== 'ready') return false
  if (!binding.templateAccountId || !binding.selectedAccountId) return false
  return binding.templateAccountId !== binding.selectedAccountId
}

/**
 * 保存を閉じる理由。**`null` のときだけ保存の口を開ける。**
 *
 * 中身の入力（名前・本文）とは分けている。こちらは「その中身を、その
 * 送り先へ送ってよいか」の話で、押す前から決まる。押してから知らせる
 * のでは、押せてしまう瞬間があるのと同じ。
 */
function templateSaveGuard(binding: TemplateAccountBinding): string | null {
  if (binding.templateId) {
    if (binding.templateStatus === 'failed') return TEMPLATE_LOAD_FAILED_MESSAGE
    /*
     * 取得が終わるまで閉じる。**ここが開いていると、A を読んだあと URL を
     * B へ替えた直後に、A の本文を `PUT /api/templates/B` へ送れる。**
     * 送り先だけ先に切り替わり、中身が追いつくまでの間があるため。
     */
    if (binding.templateStatus !== 'ready') return TEMPLATE_LOADING_MESSAGE
  }
  if (templateAccountMismatch(binding)) return ACCOUNT_MISMATCH_MESSAGE
  return null
}

/**
 * 差し込み候補の取り込み。**遅れて届いた古い応答は捨てる。**
 *
 * A から B へ替えると、A への問い合わせのほうが後に返ることがある。
 * 届いた順に入れると、B を編集しているのに A の候補が並ぶ。
 * 出した順番を持ち、いちばん新しい要求以外は結果を返さない。
 *
 * 捨てたときは `null`、読めなかったときは `'failed'`。
 */
async function requestTemplateReferences(request: {
  load: (accountId: string) => Promise<TemplateReferences>
  accountId: string
  generation: number
  currentGeneration: () => number
}): Promise<TemplateReferences | 'failed' | null> {
  try {
    const references = await request.load(request.accountId)
    return request.generation === request.currentGeneration() ? references : null
  } catch {
    return request.generation === request.currentGeneration() ? 'failed' : null
  }
}

interface TemplateSaveInput extends TemplateAccountBinding {
  name: string
  category: string
  messageType: string
  messageContent: string
  folderId: string | null
}

/**
 * 保存してよいか。**駄目な理由を返す。`null` なら保存してよい。**
 *
 * 所属と選択の食い違いをここで止める。止めないと、B の候補を挿した本文が
 * A のテンプレートとして保存される。保存する口 (`PUT /api/templates/:id`)
 * は所属アカウントを受け取らないので、サーバー側では気づけない。
 */
function validateTemplateSave(input: TemplateSaveInput): string | null {
  const guard = templateSaveGuard(input)
  if (guard) return guard
  if (!input.templateId && !input.selectedAccountId) return '上のバーでLINE公式アカウントを選んでください'
  if (!input.name.trim()) return '名前を入力してください'
  if (!input.messageContent.trim()) return '本文を入力してください'
  return null
}

interface TemplateSaveOps {
  create: typeof api.templates.create
  update: typeof api.templates.update
}

/**
 * 保存する。**断る条件に当たったら、APIを一度も呼ばない。**
 *
 * 画面側でボタンを塞ぐだけだと、状態が入れ替わる途中の押下を拾えない。
 * 送る直前に、送り先と中身が同じテンプレートのものか確かめ直す。
 */
async function saveTemplateEdit(
  input: TemplateSaveInput,
  ops: TemplateSaveOps = { create: api.templates.create, update: api.templates.update },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const blocked = validateTemplateSave(input)
  if (blocked) return { ok: false, error: blocked }

  const payload = {
    name: input.name.trim(),
    category: input.category,
    messageType: input.messageType,
    messageContent: input.messageContent,
    folderId: input.folderId,
  }
  try {
    const res = input.templateId
      ? await ops.update(input.templateId, payload)
      : await ops.create({ accountId: input.selectedAccountId as string, ...payload })
    return res.success ? { ok: true } : { ok: false, error: res.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '保存に失敗しました' }
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
    /*
     * 過ぎた日を負の数で見せない。実際に送るときは
     * `apps/worker/src/services/interpolation-date.ts` の `daysUntil` が
     * `diff > 0 ? diff : 0` を返す。見本だけ `-3` と出すと、運用する人は
     * 「マイナスで届く」と読む。**見本と実配信で違う数を見せない。**
     */
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
  /** 候補がどのアカウントのものか。既存テンプレートでは所属アカウントの名前。 */
  accountLabel?: string | null
  /*
   * 目標日は親が持つ。この並びに状態を持たせると、差し込みを選んだ拍子に
   * 入れ直した日付が消えることがある。状態を1か所に寄せる。
   */
  targetDate: string
  onTargetDateChange: (value: string) => void
  onInsert: (token: string) => void
}

function TemplateInsertControls({
  accountId,
  state,
  accountLabel,
  targetDate,
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
            onChange={(event) => onTargetDateChange(event.target.value)}
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
      {accountLabel && (
        <p className="text-ink-faint text-xs">
          候補は「{accountLabel}」の友だち情報と共通情報です。
        </p>
      )}
      {!accountId && (
        <p className="text-ink-faint text-xs">LINE公式アカウントを選ぶと、友だち情報と共通情報を選べます。</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="text-danger text-xs">差し込み項目を読み込めませんでした。画面を再読み込みしてください。</p>
      )}
    </div>
  )
}

/**
 * 所属アカウントと選択中アカウントが食い違っているときの知らせ。
 *
 * 「保存できません」だけでは戻し方が分からない。どのアカウントのものか、
 * 候補は何のままかを一緒に出す。
 */
function TemplateAccountNotice({
  binding,
  templateAccountLabel,
  selectedAccountLabel,
}: {
  binding: TemplateAccountBinding
  templateAccountLabel: string | null
  selectedAccountLabel: string | null
}) {
  if (!templateAccountMismatch(binding)) return null
  return (
    <div role="alert" className="border-hairline rounded-control border bg-canvas-sunken px-3 py-2 text-xs">
      <p className="text-danger font-semibold">{ACCOUNT_MISMATCH_MESSAGE}</p>
      <p className="text-ink-secondary mt-1">
        このテンプレートは「{templateAccountLabel ?? binding.templateAccountId}」のものです。
        いま選んでいるのは「{selectedAccountLabel ?? binding.selectedAccountId}」です。
      </p>
      <p className="text-ink-secondary mt-1">
        差し込み候補は「{templateAccountLabel ?? binding.templateAccountId}」のまま出しています。
      </p>
    </div>
  )
}

/** 編集中の中身。テンプレート1件分の下書き。 */
interface TemplateDraft {
  name: string
  category: string
  folderId: string | null
  messageType: string
  messageContent: string
}

/**
 * 画面が持つ「テンプレート1件分」の状態。
 *
 * **`requestedId` と中身を必ず一緒に動かす。** 別々の `useState` に置くと、
 * URL の id だけ先に変わり、中身が前のテンプレートのまま残る瞬間ができる。
 * その瞬間に保存すると、前のテンプレートの本文が新しい id へ入る。
 */
interface TemplateEditorState {
  requestedId: string | null
  status: TemplateLoadStatus
  templateAccountId: string | null
  draft: TemplateDraft
}

function newTemplateEditorState(templateId: string | null, visual: boolean): TemplateEditorState {
  return {
    requestedId: templateId,
    status: templateId ? 'loading' : 'idle',
    templateAccountId: null,
    draft: {
      name: visual ? '定期便 初回のご案内' : '',
      // category は旧一覧との互換用に保存だけ続ける。分け方は folderId に一本化する。
      category: 'general',
      folderId: null,
      messageType: 'text',
      messageContent: visual
        ? '{{name}}さん、いつもありがとうございます。\n初回のお届け予定はこちらです。\nhttps://example.co.jp/first-delivery'
        : '',
    },
  }
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
  const { accounts, selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const assetKind = params.get('kind')
  const visual = params.get('visual') === '1'
  usePageTitle(id ? 'メッセージを編集' : 'メッセージを作る')

  const [folders, setFolders] = useState<Folder[]>([])
  const [references, setReferences] = useState<TemplateReferences>(EMPTY_REFERENCES)
  const [referenceState, setReferenceState] = useState<ReferenceState>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editorState, setEditor] = useState<TemplateEditorState>(() => newTemplateEditorState(id, visual))

  /*
   * URL の id が変わった瞬間に、前のテンプレートの中身を捨てる。
   *
   * **`useEffect` で捨てるのでは遅い。** 効果が動くまでの1回の描画で
   * 「本文は A・所属は A・送り先は B」という組み合わせが画面に出てしまい、
   * そこで保存すると A の本文が `PUT /api/templates/B` へ流れる。
   * 描画の途中で捨てれば、その組み合わせは一度も現れない。
   * （描画中の `setState` は React が認めている「props に合わせて状態を
   *  直す」書き方。この描画は捨てられ、すぐ新しい状態で描き直される。）
   */
  let editor = editorState
  if (editor.requestedId !== id) {
    editor = newTemplateEditorState(id, visual)
    setEditor(editor)
  }

  const { name, category, folderId, messageType, messageContent } = editor.draft
  const updateDraft = (patch: Partial<TemplateDraft>) =>
    setEditor((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }))

  const binding: TemplateAccountBinding = {
    templateId: id,
    templateStatus: editor.status,
    templateAccountId: editor.templateAccountId,
    selectedAccountId,
  }
  const editorAccountId = resolveEditorAccountId(binding)
  const accountMismatch = templateAccountMismatch(binding)
  const saveGuard = templateSaveGuard(binding)
  // 読み込めていない本文のまま保存すると、空で上書きする危険がある。
  const loadFailed = editor.status === 'failed'
  const loading = Boolean(id) && (editor.status === 'idle' || editor.status === 'loading')
  const accountName = (accountId: string | null) =>
    accounts.find((account) => account.id === accountId)?.name ?? null

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

  /*
   * 出した順番。片付けのたびに1つ進めるので、画面から離れたあとの応答も、
   * アカウントを替える前に出した応答も、いちばん新しい要求と一致しない。
   */
  const referenceGeneration = useRef(0)

  useEffect(() => {
    setReferences(EMPTY_REFERENCES)
    const generation = ++referenceGeneration.current
    if (!editorAccountId) {
      setReferenceState('idle')
      return
    }

    setReferenceState('loading')
    void requestTemplateReferences({
      load: loadTemplateReferences,
      accountId: editorAccountId,
      generation,
      currentGeneration: () => referenceGeneration.current,
    }).then((result) => {
      if (result === null) return
      if (result === 'failed') {
        setReferences(EMPTY_REFERENCES)
        setReferenceState('failed')
        return
      }
      setReferences(result)
      setReferenceState('ready')
    })
    return () => { referenceGeneration.current += 1 }
  }, [editorAccountId])

  /*
   * 取得の世代。id を替えるたびに1つ進める。片付けでも進めるので、
   * 前の id への応答も、画面を離れたあとの応答も、現世代と一致しない。
   */
  const templateGeneration = useRef(0)

  useEffect(() => {
    if (!id) return
    const generation = ++templateGeneration.current
    /** 現世代で、いまも同じ id を開いているときだけ書き込む。 */
    const accept = (next: (prev: TemplateEditorState) => TemplateEditorState) => {
      if (generation !== templateGeneration.current) return
      setEditor((prev) => (prev.requestedId === id ? next(prev) : prev))
    }
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success) {
          accept((prev) => ({ ...prev, status: 'failed' }))
          return
        }
        // 所属アカウントと本文は、同じ応答から一度に入れる。片方だけ先に
        // 入れると、その間だけ食い違いの判定が別の答えを出す。
        accept(() => ({
          requestedId: id,
          status: 'ready',
          templateAccountId: res.data.accountId ?? null,
          draft: {
            name: res.data.name,
            category: res.data.category ?? '',
            folderId: res.data.folderId ?? null,
            messageType: res.data.messageType,
            messageContent: res.data.messageContent,
          },
        }))
      })
      .catch(() => accept((prev) => ({ ...prev, status: 'failed' })))
    return () => { templateGeneration.current += 1 }
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
      updateDraft({ messageContent: messageContent + token })
      return
    }
    const start = el.selectionStart ?? messageContent.length
    const end = el.selectionEnd ?? start
    const next = messageContent.slice(0, start) + token + messageContent.slice(end)
    updateDraft({ messageContent: next })
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
    const input: TemplateSaveInput = {
      ...binding,
      name,
      category,
      messageType,
      messageContent,
      folderId,
    }
    const blocked = validateTemplateSave(input)
    if (blocked) {
      setError(blocked)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await saveTemplateEdit(input)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push('/templates')
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
              onChange={(e) => updateDraft({ name: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="置き場" htmlFor="tp-folder" note="一覧のフォルダ分けと絞り込みに使います。">
            <SelectField
              id="tp-folder"
              value={folderId ?? ''}
              onChange={(e) => updateDraft({ folderId: e.target.value || null })}
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
              onChange={(e) => updateDraft({ messageType: e.target.value })}
              options={TYPES.map((t) => ({ value: t.value, label: t.label }))}
              className={inputClass}
            />
          </Field>

          <TemplateAccountNotice
            binding={binding}
            templateAccountLabel={accountName(editor.templateAccountId)}
            selectedAccountLabel={accountName(selectedAccountId)}
          />

          <div>
            <p className="text-ink-secondary mb-1 text-sm font-medium">差し込む</p>
            <TemplateInsertControls
              accountId={editorAccountId}
              state={referenceState}
              accountLabel={accountMismatch ? accountName(editorAccountId) : null}
              targetDate={targetDate}
              onTargetDateChange={setTargetDate}
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
              onChange={(e) => updateDraft({ messageContent: e.target.value })}
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

          {(loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error) && (
            <p className="text-danger text-sm">{loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error}</p>
          )}

          {saveGuard && !loadFailed && !accountMismatch && (
            <p role="status" className="text-ink-secondary text-sm">{saveGuard}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || loadFailed || saveGuard !== null}
              title={saveGuard ?? undefined}
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

function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditInner />
    </Suspense>
  )
}

/*
 * 試験から触れる口。**画面を組み立て直さずに、実際に動く部品を呼ぶ。**
 * ここに出すのは、画面本体がそのまま使っている関数と部品だけ。
 */
const TemplateEditPageWithTestSupport = Object.assign(TemplateEditPage, {
  __testing: {
    ACCOUNT_MISMATCH_MESSAGE,
    TEMPLATE_LOADING_MESSAGE,
    TEMPLATE_LOAD_FAILED_MESSAGE,
    TemplateAccountNotice,
    TemplateEditInner,
    TemplateInsertControls,
    buildTemplatePreview,
    loadTemplateReferences,
    previewDateValue,
    requestTemplateReferences,
    resolveEditorAccountId,
    saveTemplateEdit,
    templateAccountMismatch,
    templateSaveGuard,
    validateTemplateSave,
  },
})

export default TemplateEditPageWithTestSupport
