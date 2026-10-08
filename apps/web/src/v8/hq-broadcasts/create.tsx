'use client'

/*
 * ★V8 統括 一括配信を作る（B-37・絵 V8.pen の BBRDb：① lmWCZ・② AL5vR・③ lLyFR・④ ZU4Ae・⑤ H9eG3n）。
 *
 * オーナー 10-08：「店の一斉配信とほぼ同じ画面にする。違いは送るアカウントを選ぶだけ」。
 * 店の一斉配信を作る画面（components/broadcasts/broadcast-form.tsx）と同じ5段・同じ部品（段の帯・選ぶカード・
 * LINE の見え方・下の帯）・同じ見た目（店の CSS をそのまま読む）で組む。統括だけの口は2つ：
 *   - ② 配信対象の上の「送るアカウント」（J5DH6o：フォルダの札で絞り、アカウントのカードにチェック）
 *   - ⑤ 最終確認の「アカウントごとの確かめ」（送る人数・今月の送信枠の残り・LINE の接続・止めているか。問題のある店は外す）
 * 読み書きは統括の一括配信の口（API-7 の hq-broadcasts）。店の口（承認・テスト送信・分散・配信後のアクション・
 * 除くタグ・詳細条件）は統括の口に無いので出さない（BEHAVIOR.md の「今の口で出せないもの」）。
 */
import { Steps } from '@/components/templates/steps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Eye, Plus, Save, Send, Trash2 } from 'lucide-react'
import type { Folder, HqBroadcastInput, HqBroadcastPreflight, HqBroadcastRun, LineAccount, MessageTemplateDefinition, SegmentCondition } from '@line-crm/shared'
import ConditionBuilder from '@/components/shared/condition-builder'
import Dialog from '@/components/shared/dialog'
import { SingleOperatorFields } from '@/components/broadcasts/broadcast-approval'
import { BubblePreview, MediaUpload } from '@/components/broadcasts/broadcast-form'
import MessageKindFields, { emptyMessageKindState, type MessageKind, type MessageKindState } from '@/components/scenarios/message-kind-fields'
import { TARGET_MODES } from '@/lib/broadcast-audience'
import { pruneCondition } from '@/lib/segment-condition'
import { HqApprovalBlock, HqTestSendDialog, approvalGate, useHqApproval } from './approval'
import Button from '@/components/shared/button'
import CheckCard from '@/components/shared/check-card'
import Checkbox from '@/components/shared/checkbox'
import Combobox from '@/components/shared/combobox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import FilterChip from '@/components/shared/filter-chip'
import { FolderDot, FolderDotName } from '@/components/shared/folder-dot'
import HelpTip from '@/components/shared/help-tip'
import SearchField from '@/components/shared/search-field'
import InsertTextField, { InsertButton, type InsertTextFieldHandle } from '@/components/shared/insert-text-field'
import LinePreview from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { RequiredBadge } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import FolderSelect from '@/components/shared/folder-select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { broadcastSteps, type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import formStyles from '@/components/broadcasts/broadcast-form-v8.module.css'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ApiError, api, describeSaveFailure, type BroadcastMessageAsset } from '@/lib/api'
import { bubbleLegacyMessage } from '@/lib/broadcast-template'
import { formatNumber, formatRelative } from '@/lib/format'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { hqTemplatesApi, type HqTemplateListItem } from '@/lib/hq-templates-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import RowMenu from './row-menu'
import { ASSET_KIND, STORE_INSERTS, STORE_INSERT_CHIPS, type HqKind, fromApiContent, jpDateTime, preflightBadge, previewText, sendTotals, splitPreflightRows, toApiContent } from './model'
import { HQ_KIND_LABEL, HQ_KIND_TABS, HQ_NOT_YET, bubbleFromTemplate, carouselColumns, emptyContent, fromApiBubble, hqBubbleProblem, previewBubbleOf, bubbleFromHostContent, hostContentOfBubble, templateContentOfBubble, hqBubbleSummary, newHqBubble, notYetText, toApiBubble, type HqBubble } from './bubbles'
import HqTemplatePicker from './template-picker'
import CarouselV8 from '@/v8/templates/carousel'
import TemplateRichEditor from '@/v8/template-edit/rich'
import type { TemplateEditHost } from '@/v8/template-edit/host'
import { hostDefinition } from '@/v8/hq-templates/console'
import { freshDefinition } from '@/lib/hq-template-authoring'
import styles from './create.module.css'

type Store = Pick<LineAccount, 'id' | 'name' | 'tags'> & { friendCount: number; folderId: string | null; folder: Folder | null }
/** 配信対象（店の一斉配信と同じ4つ。名前は店の口と同じ：詳細条件は advanced）。 */
type Audience = 'all' | 'scenario' | 'tag' | 'advanced'
type Method = 'new' | 'template' | 'duplicate'
/** 吹き出し1つ（店の一斉配信と同じく5つまで）。種類と口への形は bubbles.ts。 */
type Bubble = HqBubble
const MAX_BUBBLES = 5
const newBubble = newHqBubble
/**
 * 統括の条件で選べる種類（API-18：タグ・シナリオは各アカウントの同じ名前に直す）。
 * 友だち情報・対応マーク・回答フォーム・個別の友だち・分析の対象・クリック履歴は店ごとの ID なので選ばせない。
 */
const HQ_RULE_KINDS = ['name', 'private_memo', 'status_message', 'registered_at', 'tag_exists', 'scenario_subscribed', 'scenario_state', 'last_reaction_at', 'reaction_state', 'score_range', 'is_following', 'is_hidden']

const STEP_ORDER: BroadcastStepKey[] = ['basic', 'audience', 'message', 'schedule', 'confirm']
const STEP_SET = new Set<string>(STEP_ORDER)
const TITLE_MAX = 60
const BODY_MAX = 5000
/** 表に1行ずつ出すのは4店まで。残りは「ほか N店」にまとめ、「…」から全部を開く。 */
const ROWS_SHOWN = 4
/** 「すべて」の札と、フォルダに入っていないアカウントの札。 */
const ALL = '__all__'
const UNFILED = '__none__'

const KIND_LABEL = HQ_KIND_LABEL

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return '統括全体の編集権限がある人だけが一括配信を作れます。'
    if (caught.status === 409) return japaneseDetailOf(caught) || 'ほかの人が先に操作しました。もう一度確かめてください。'
    return describeSaveFailure(caught)
  }
  // 「API error: 500」のような内部の文は出さない。
  return japaneseDetailOf(caught) || fallback
}

const TEMPLATE_KIND_NAME: Record<string, string> = { message: 'メッセージ', carousel: 'カルーセル', rich_message: 'リッチメッセージ', question: '質問', coupon: 'クーポン', research: 'リサーチ' }

/** 「9/20」。 */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1}/${d.getDate()}`
}

/** 送った人数（外したアカウントを除く）。 */
function runPeople(run: HqBroadcastRun): number {
  return run.targets.reduce((sum, t) => sum + (t.excluded ? 0 : t.totalCount || 0), 0)
}

/** 配信の中身の種類（「テキスト＋カルーセル」）。 */
function runKinds(run: HqBroadcastRun): string {
  return [...new Set(bubblesFromInput(run.input ?? { messageContent: '' }).map((b) => HQ_KIND_LABEL[b.kind]))].join('＋')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日付（YYYY-MM-DD）と時刻（HH:MM）を日本時間として ISO にする（店の一斉配信と同じ「日本時間」の欄）。 */
function jstIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time}:00+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 下書きの日時（ISO）を、日本時間の日付と時刻の欄に戻す。 */
function splitJst(iso: string): { date: string; time: string } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return { date: `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`, time: `${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}` }
}

/** 素材（クーポン・リッチメッセージ）を吹き出しの中身にする。口の messageBubblesJson と同じ形（店側の一斉配信と同じ）。 */
function assetContent(asset: BroadcastMessageAsset): Record<string, unknown> {
  return { assetId: asset.id, assetName: asset.name, ...asset.payload }
}

/** 保存した吹き出し（messageBubblesJson）を画面の吹き出しに戻す。読めなければ本文1つ。 */
function bubblesFromInput(saved: Pick<HqBroadcastInput, 'messageBubblesJson' | 'messageContent'>): Bubble[] {
  let raw: Array<{ id?: string; type?: string; content?: Record<string, unknown> }> = []
  try { raw = saved.messageBubblesJson ? JSON.parse(saved.messageBubblesJson) : [] } catch { raw = [] }
  const list = (Array.isArray(raw) ? raw : []).flatMap((item): Bubble[] => { const b = fromApiBubble(item); return b ? [b] : [] })
  return list.length ? list.slice(0, MAX_BUBBLES) : [{ ...newBubble('text'), body: fromApiContent(saved.messageContent ?? '') }]
}

/** 保存した配信対象を画面の選び方に戻す（シナリオ1つだけの条件はシナリオ、ほかは詳細条件）。 */
function audienceFromInput(saved: HqBroadcastInput): { audience: Audience; tagName: string; scenarioName: string; condition: SegmentCondition | null; savedName: string } {
  const empty = { tagName: '', scenarioName: '', condition: null, savedName: '' }
  if (saved.audience?.kind === 'tag') return { ...empty, audience: 'tag', tagName: saved.audience.tagName }
  if (saved.targetType === 'segment') {
    const rules = saved.segmentConditions?.rules ?? []
    if (!saved.savedSearchId && rules.length === 1 && rules[0].type === 'scenario_subscribed' && !(saved.segmentConditions?.groups ?? []).length) {
      return { ...empty, audience: 'scenario', scenarioName: String(rules[0].value ?? '') }
    }
    return { ...empty, audience: 'advanced', condition: saved.segmentConditions ?? null, savedName: saved.savedSearchId ?? '' }
  }
  return { ...empty, audience: 'all' }
}

export default function HqBroadcastCreate() {
  /* ③ でカルーセル・リッチメッセージをその場で作っている間は、店の作る部品（template-edit/host の口）を画面いっぱいに出す。 */
  const [composer, setComposer] = useState<null | 'carousel' | 'rich'>(null)
  /* 部品も画面名を付けるので、親（この画面）の名前で上書きする（部品より後に走る）。閉じたら一括配信を作るに戻す。 */
  usePageTitle(composer === 'carousel' ? 'カルーセルを作る' : composer === 'rich' ? 'リッチメッセージを作る' : '一括配信を作る')
  usePageCrumbs(composer ? [{ label: '一括配信', href: '/hq/broadcasts' }, { label: '一括配信を作る', href: '/hq/broadcasts/new' }] : [{ label: '一括配信', href: '/hq/broadcasts' }])
  const router = useRouter()
  const params = useSearchParams()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)

  /* 段は ?step=（店の一斉配信と同じ名前・同じ値）。押した段はすぐ出し、URL は履歴を積まずに書き換える。 */
  const urlStep = params.get('step')
  const [step, setStep] = useState<BroadcastStepKey>(urlStep && STEP_SET.has(urlStep) ? urlStep as BroadcastStepKey : 'basic')
  /* 下書きを直すとき（?id=）。保存した下書きは URL に id を残し、読み直しても同じ下書きを開く。 */
  const [draftId, setDraftId] = useState(params.get('id') ?? '')
  const [draftState, setDraftState] = useState<'none' | 'loading' | 'ready' | 'sent' | 'error'>(params.get('id') ? 'loading' : 'none')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const [stores, setStores] = useState<Store[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [loadError, setLoadError] = useState<unknown>(null)
  const [folderFilter, setFolderFilter] = useState<string>(params.get('folder') ?? ALL)
  const [accountIds, setAccountIds] = useState<string[]>([])
  /* 昔の入口（?tag=<アカウントのタグ>）と、タグで作った下書き。読んだあとはアカウントを1つずつ選んだ形に直す。 */
  const legacyTags = useRef<string[]>(params.get('tag') ? [params.get('tag')!] : [])
  const [excluded, setExcluded] = useState<string[]>([])

  const [method, setMethod] = useState<Method>('new')
  const [title, setTitle] = useState('')
  const [recent, setRecent] = useState<HqBroadcastRun[]>([])
  const [templates, setTemplates] = useState<HqTemplateListItem[] | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [templateQuery, setTemplateQuery] = useState('')
  /* ① 「過去の配信を複製」の一覧（送った一括配信）と、選んだ配信。 */
  const [sentRuns, setSentRuns] = useState<HqBroadcastRun[] | null>(null)
  const [copiedId, setCopiedId] = useState('')

  /* ① フォルダ（統括の一括配信のフォルダ）・社内メモ（API-18）。 */
  const [hqFolders, setHqFolders] = useState<Array<{ id: string; name: string }>>([])
  /* フォルダを選ぶ欄からその場で作る（dLffh）。一覧の左の列と同じ口。色は持たない。 */
  const createHqFolder = async (name: string) => {
    const created = (await hqBroadcastsApi.createFolder(name)).data
    setHqFolders((current) => [...current, { id: created.id, name: created.name }])
    return { value: created.id, label: created.name }
  }
  const [folderId, setFolderId] = useState('')
  const [internalMemo, setInternalMemo] = useState('')

  const [audience, setAudience] = useState<Audience>('all')
  const [tagName, setTagName] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [condition, setCondition] = useState<SegmentCondition | null>(null)
  const [conditionDraft, setConditionDraft] = useState<SegmentCondition | null>(null)
  const [conditionOpen, setConditionOpen] = useState(false)
  const [savedName, setSavedName] = useState('')
  const [excludeTag, setExcludeTag] = useState('')
  /*
   * 配信対象の候補：選んだアカウントのタグ・シナリオ・保存した条件の名前（同じ名前を各アカウントで探して送る。API-18）。
   * accounts はその名前を持っているアカウントの数。
   */
  const [tagOptions, setTagOptions] = useState<Array<{ name: string; accounts: number }> | null>(null)
  const [scenarioOptions, setScenarioOptions] = useState<Array<{ name: string; accounts: number }> | null>(null)
  const [savedOptions, setSavedOptions] = useState<Array<{ name: string; accounts: number }> | null>(null)
  const [tagStatus, setTagStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  /* ③ 吹き出し（5つまで）。開いているのは1つ。 */
  const [bubbles, setBubbles] = useState<Bubble[]>(() => [newBubble('text')])
  const [openBubble, setOpenBubble] = useState(0)
  const active = bubbles[Math.min(openBubble, bubbles.length - 1)]
  const kind = active.kind
  const body = active.body
  const setBody = (next: string | ((text: string) => string)) => setBubbles((items) => items.map((item, index) => (index === Math.min(openBubble, items.length - 1) ? { ...item, body: typeof next === 'function' ? next(item.body) : next } : item)))
  const setKind = (next: HqKind) => setBubbles((items) => items.map((item, index) => (index === Math.min(openBubble, items.length - 1) ? { ...item, kind: next, content: emptyContent(next), cardAsset: undefined } : item)))
  /** 開いている吹き出しの中身（画像・動画・位置情報・カルーセル・素材など）を差し替える。 */
  const setContent = (next: Record<string, unknown>, cardAsset?: boolean) => setBubbles((items) => items.map((item, index) => (index === Math.min(openBubble, items.length - 1) ? { ...item, content: next, cardAsset } : item)))
  /** 開いている吹き出しを、ひな形から読んだ吹き出しに置き換える。 */
  const replaceActive = (next: Bubble) => setBubbles((items) => items.map((item, index) => (index === Math.min(openBubble, items.length - 1) ? { ...next, id: item.id } : item)))
  const bodyRef = useRef<InsertTextFieldHandle | HTMLTextAreaElement>(null)
  /* 統括で使える共有の素材（どの店にも属さないクーポン・リッチメッセージ）。 */
  const [assets, setAssets] = useState<BroadcastMessageAsset[] | null>(null)
  const assetId = String(active.content.assetId ?? '')
  const setAssetId = (next: string) => { const found = (assets ?? []).find((a) => a.id === next); setContent(found ? assetContent(found) : {}) }
  /* 統括のカルーセルのひな形（③ のカルーセル）と、［テンプレートから選ぶ］の窓。 */
  const [carousels, setCarousels] = useState<HqTemplateListItem[] | null>(null)
  const [carouselError, setCarouselError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  /* ［保存してテンプレート化する］（開いている吹き出しを統括のひな形に保存する）。 */
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [saveTplName, setSaveTplName] = useState('')
  const [saveTplBusy, setSaveTplBusy] = useState(false)
  const [saveTplError, setSaveTplError] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const [approvalRequestOpen, setApprovalRequestOpen] = useState(false)
  const [confirmCount, setConfirmCount] = useState('')
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'phone' | 'pc'>('phone')

  const [when, setWhen] = useState<'now' | 'later'>('later')
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d) })
  const [time, setTime] = useState('11:00')

  const [run, setRun] = useState<HqBroadcastRun | null>(null)
  const [runKey, setRunKey] = useState('')
  const [checks, setChecks] = useState<HqBroadcastPreflight[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [errorStep, setErrorStep] = useState<BroadcastStepKey | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [leaving, setLeaving] = useState(false)
  /* 下書きの依頼番号。作ったとき（または読んだ下書き）のものを、直すときもそのまま使う（口の決まり）。 */
  const requestRef = useRef('')
  /* WEB011：requestRef を作った中身（key）。中身が同じやり直しは同じ依頼番号を使う。 */
  const createKeyRef = useRef('')

  useEffect(() => {
    let current = true
    void Promise.all([
      api.lineAccounts.list(),
      api.lineAccountFolders.list().catch(() => null),
      hqBroadcastsApi.list().catch(() => null),
      hqBroadcastsApi.folders().catch(() => null),
    ])
      .then(([accounts, folderList, runs, broadcastFolders]) => {
        if (current && broadcastFolders) setHqFolders(broadcastFolders.data.map((f) => ({ id: f.id, name: f.name })))
        if (!current) return
        if (!accounts.success) throw new Error(accounts.error)
        const list: Store[] = accounts.data
          .filter((a) => !a.archivedAt)
          .map((a) => ({ id: a.id, name: a.name, tags: a.tags ?? [], friendCount: a.stats?.friendCount ?? 0, folderId: a.folderId ?? null, folder: a.folder ?? null }))
        setStores(list)
        if (folderList?.success) setFolders(folderList.data.folders)
        const sent = runs ? runs.data.filter((r) => r.status !== 'prepared') : []
        setRecent(sent.slice(0, 2)); setSentRuns(sent)
        if (legacyTags.current.length > 0) {
          const ids = list.filter((s) => s.tags?.some((t) => legacyTags.current.includes(t.id))).map((s) => s.id)
          setAccountIds((prev) => [...new Set([...prev, ...ids])])
          legacyTags.current = []
        }
      })
      .catch((caught) => { if (current) setLoadError(caught) })
    return () => { current = false }
  }, [])

  /** 保存した中身（下書き・複製元）のフォルダ・メモ・対象・吹き出しを画面に戻す。 */
  const applySaved = (saved: HqBroadcastInput) => {
    setFolderId(saved.folderId ?? '')
    setInternalMemo(saved.internalMemo ?? '')
    const target = audienceFromInput(saved)
    setAudience(target.audience); setTagName(target.tagName); setScenarioName(target.scenarioName); setCondition(target.condition); setSavedName(target.savedName)
    setExcludeTag(saved.excludedTagIds?.[0] ?? '')
    setBubbles(bubblesFromInput(saved)); setOpenBubble(0)
  }

  /* 下書きを読む（?id=）。本文・送るアカウント・対象・時刻を戻し、確かめるときは同じ下書きを直す。 */
  useEffect(() => {
    const id = params.get('id')
    if (!id) return
    let current = true
    void hqBroadcastsApi.get(id)
      .then((res) => {
        if (!current) return
        const draft = res.data
        if (draft.status !== 'prepared') { setDraftState('sent'); return }
        const saved = draft.input
        setTitle(saved.title ?? '')
        setAccountIds(saved.accountIds)
        if (saved.accountTagIds.length > 0) legacyTags.current = saved.accountTagIds
        setExcluded(saved.excludedAccountIds)
        applySaved(saved)
        const at = saved.scheduledAt ? splitJst(saved.scheduledAt) : null
        if (at) { setWhen('later'); setDate(at.date); setTime(at.time) } else setWhen('now')
        requestRef.current = saved.requestId
        setRun(draft)
        setDraftState('ready')
      })
      .catch(() => { if (current) setDraftState('error') })
    return () => { current = false }
  }, [params])

  /* 詳細の［複製して作る］（?copy=<一括配信の id>）：配信名・中身・送るアカウント・対象を写して新しく作る。 */
  useEffect(() => {
    const copyId = params.get('copy')
    if (!copyId || params.get('id')) return
    let current = true
    void hqBroadcastsApi.get(copyId).then((res) => { if (current) duplicate(res.data) }).catch(() => { if (current) setError('複製する一括配信を読み込めませんでした。一覧から開き直してください。') })
    return () => { current = false }
    // 開いたときに一度だけ写す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* タグで読んだ下書きは、店の一覧が届いてからアカウントへ直す。 */
  useEffect(() => {
    if (!stores || legacyTags.current.length === 0) return
    const ids = stores.filter((s) => s.tags?.some((t) => legacyTags.current.includes(t.id))).map((s) => s.id)
    setAccountIds((prev) => [...new Set([...prev, ...ids])])
    legacyTags.current = []
  }, [stores, draftState])

  const needsAssets = bubbles.some((item) => item.kind === 'rich' || item.kind === 'coupon')
  useEffect(() => {
    if (!needsAssets || assets) return
    let current = true
    void api.broadcastMessageAssets.list()
      .then((res) => { if (current) setAssets(res.success ? res.data.filter((a) => a.lineAccountId === null && (a.kind === 'coupon' || a.kind === 'rich_message')) : []) })
      .catch(() => { if (current) setAssets([]) })
    return () => { current = false }
  }, [needsAssets, assets])

  const needsCarousels = bubbles.some((item) => item.kind === 'carousel')
  useEffect(() => {
    if (!needsCarousels || carousels) return
    let current = true
    void hqTemplatesApi.listByKind('carousel').then((list) => { if (current) setCarousels(list) }).catch(() => { if (current) setCarousels([]) })
    return () => { current = false }
  }, [needsCarousels, carousels])

  const chosen = useMemo(() => (stores ?? []).filter((s) => accountIds.includes(s.id)), [stores, accountIds])

  /* 配信対象の候補：選んだアカウントごとにタグ・シナリオ・保存した条件を読み、同じ名前でまとめる。 */
  const loadTags = useCallback(async () => {
    if (chosen.length === 0) { setTagOptions([]); setScenarioOptions([]); setSavedOptions([]); setTagStatus('ready'); return }
    setTagStatus('loading')
    const group = (lists: string[][]) => {
      const count = new Map<string, number>()
      for (const names of lists) for (const name of new Set(names)) count.set(name, (count.get(name) ?? 0) + 1)
      return [...count].map(([name, accounts]) => ({ name, accounts })).sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name, 'ja'))
    }
    try {
      const [tagLists, scenarioLists, savedLists] = await Promise.all([
        Promise.all(chosen.map((s) => api.tags.list({ accountId: s.id }))),
        Promise.all(chosen.map((s) => api.scenarios.list({ accountId: s.id }).catch(() => null))),
        Promise.all(chosen.map((s) => api.segmentPresets.list(s.id).catch(() => null))),
      ])
      if (tagLists.some((res) => !res.success)) throw new Error('tags')
      setTagOptions(group(tagLists.map((res) => (res.success ? res.data.map((t) => t.name) : []))))
      setScenarioOptions(group(scenarioLists.map((res) => (res && res.success ? res.data.map((t) => t.name) : []))))
      setSavedOptions(group(savedLists.map((res) => (res && res.success ? res.data.map((t) => t.name) : []))))
      setTagStatus('ready')
    } catch {
      setTagStatus('error')
    }
  }, [chosen])
  const tagKey = chosen.map((s) => s.id).join(',')
  useEffect(() => {
    if (step !== 'audience' && audience === 'all') return
    void loadTags()
    // 選んだアカウントが変わったときだけ読み直す。
  }, [audience, tagKey, step === 'audience']) // eslint-disable-line react-hooks/exhaustive-deps

  const changeStep = (next: BroadcastStepKey) => {
    setStep(next)
    const q = new URLSearchParams(params.toString())
    if (next === 'basic') q.delete('step'); else q.set('step', next)
    if (draftId) q.set('id', draftId)
    router.replace(`/hq/broadcasts/new${q.size ? `?${q.toString()}` : ''}`, { scroll: false })
    if (next === 'confirm' && (!checks || stale)) void check()
  }

  const scheduledAt = when === 'now' ? null : jstIso(date, time)
  const kindAssets = (assets ?? []).filter((a) => (kind === 'rich' || kind === 'coupon') && a.kind === ASSET_KIND[kind])
  /* 吹き出しは口の messageBubblesJson と同じ形（店の一斉配信と同じ）。テキスト1つだけのときは今までどおり本文だけで送る。 */
  const apiBubbles = bubbles.map((item, index) => toApiBubble(item, `hq-b-${index + 1}`))
  const single = bubbles.length === 1
  const bubble = single && kind !== 'text' ? apiBubbles[0] : null
  const legacy = bubble ? bubbleLegacyMessage(bubble) : null
  const firstText = bubbles.find((item) => item.kind === 'text')
  const targetMode = audience === 'scenario' || audience === 'advanced' ? 'segment' : undefined
  const segmentConditions = audience === 'scenario'
    ? { operator: 'AND' as const, rules: [{ type: 'scenario_subscribed', value: scenarioName }] }
    : audience === 'advanced' ? pruneCondition(condition) ?? undefined : undefined
  const input: Omit<HqBroadcastInput, 'requestId'> = {
    title: title.trim(),
    /* 画像・動画・スタンプ・カルーセル・素材は、店の一斉配信と同じく LINE へ渡せる種類（image・carousel・flex・imagemap など）に直して送る。 */
    messageType: single ? (kind === 'text' ? 'text' : ((legacy?.messageType ?? 'flex') as HqBroadcastInput['messageType'])) : 'text',
    messageContent: single ? (kind === 'text' ? toApiContent(body) : (legacy?.messageContent ?? '')) : toApiContent(firstText?.body ?? ''),
    ...(single ? (bubble ? { messageBubblesJson: JSON.stringify([bubble]) } : {}) : { messageBubblesJson: JSON.stringify(apiBubbles.filter(Boolean)) }),
    accountIds: chosen.map((s) => s.id),
    accountTagIds: [],
    excludedAccountIds: excluded.filter((id) => accountIds.includes(id)),
    audience: audience === 'tag' && tagName ? { kind: 'tag', tagName } : { kind: 'all' },
    ...(targetMode ? { targetType: targetMode } : {}),
    ...(segmentConditions ? { segmentConditions } : {}),
    ...(audience === 'advanced' && savedName ? { savedSearchId: savedName } : {}),
    ...(excludeTag ? { excludedTagIds: [excludeTag] } : {}),
    ...(folderId ? { folderId } : {}),
    ...(internalMemo.trim() ? { internalMemo: internalMemo.trim() } : {}),
    scheduledAt,
  }
  const key = JSON.stringify(input)
  const stale = !!run && !!checks && runKey !== key
  /* 承認の状態（⑤ を開いて確かめたあと。中身を変えると口が承認を外す）。 */
  const approval = useHqApproval(step === 'confirm' && run && !stale ? run : null)
  const gate = approvalGate(approval.state)
  /** テストを送る前に、下書きを今の中身にそろえる。 */
  const prepareForTest = async () => {
    const result = !run || stale || !checks ? await check() : { run }
    return result?.run.id ?? null
  }

  /** 入れていない所と、その欄のある段（店の一斉配信の「保存を押した段で理由を示す」と同じ）。 */
  const problem = (): { message: string; step: BroadcastStepKey } | null => {
    if (!title.trim()) return { message: '配信名を入れてください', step: 'basic' }
    if (title.trim().length > TITLE_MAX) return { message: `配信名は${TITLE_MAX}文字までです`, step: 'basic' }
    if (chosen.length === 0) return { message: '送るアカウントを選んでください', step: 'audience' }
    if (audience === 'tag' && !tagName) return { message: '送る相手のタグを選んでください', step: 'audience' }
    if (audience === 'advanced' && !pruneCondition(condition) && !savedName) return { message: '詳細条件を1つ以上入力するか、保存した条件を選んでください。全員に送るなら「友だち全員に配信する」を選んでください', step: 'audience' }
    for (const [index, item] of bubbles.entries()) {
      /* 質問・紹介（統括の口がまだ受けない）もここで止め、口を呼ばない。 */
      const why = hqBubbleProblem(item)
      if (why) return { message: `${bubbles.length > 1 ? `${index + 1}通目の` : ''}${why}`, step: 'message' }
    }
    if (when === 'later' && !scheduledAt) return { message: '送る日時を選んでください', step: 'schedule' }
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) return { message: '予約日時は今より後にしてください', step: 'schedule' }
    return null
  }

  /** 作る（下書きを固定）→ 確かめる → 問題のある店を外す。中身が変わったら同じ下書きを直す（版つき・依頼番号はそのまま）。 */
  const check = async (): Promise<{ run: HqBroadcastRun; checks: HqBroadcastPreflight[] } | null> => {
    const why = problem()
    if (why) { setError(why.message); setErrorStep(why.step); return null }
    setChecking(true); setError(''); setErrorStep(null)
    try {
      let current = run
      if (!current || runKey !== key) {
        const requestId = current?.input?.requestId || requestRef.current
        if (current && current.status === 'prepared' && requestId) {
          current = (await hqBroadcastsApi.update(current.id, { ...input, requestId, expectedVersion: current.version })).data
        } else {
          // WEB011：応答が切れた作成のやり直しは、同じ中身なら同じ依頼番号で送る（別の下書きを作らない）。
          if (!requestRef.current || createKeyRef.current !== key) {
            requestRef.current = crypto.randomUUID()
            createKeyRef.current = key
          }
          current = (await hqBroadcastsApi.create({ ...input, requestId: requestRef.current })).data
        }
        // WEB011：作れた・直せた下書きは、確かめ（preflight）の前にすぐ覚える。
        // 確かめが失敗してやり直したとき、同じ下書きを新しい版で直す（重複も 409 も起こさない）。
        setRun(current)
      }
      let list = (await hqBroadcastsApi.preflight(current.id)).data
      const blocked = list.filter((p) => p.blockedReasons.length > 0 && !p.excluded).map((p) => p.accountId)
      if (blocked.length > 0) {
        const ids = [...new Set([...list.filter((p) => p.excluded).map((p) => p.accountId), ...blocked])]
        current = (await hqBroadcastsApi.exclude(current.id, ids, current.version)).data
        setRun(current)
        list = list.map((p) => (ids.includes(p.accountId) ? { ...p, excluded: true } : p))
      }
      setRun(current); setRunKey(key); setChecks(list); setSavedAt(new Date().toISOString())
      if (current.id !== draftId) {
        setDraftId(current.id)
        const q = new URLSearchParams(params.toString())
        q.set('id', current.id)
        if (step !== 'basic') q.set('step', step)
        router.replace(`/hq/broadcasts/new?${q.toString()}`, { scroll: false })
      }
      return { run: current, checks: list }
    } catch (caught) {
      setError(errorText(caught, '送る前の確かめができませんでした。もう一度お試しください。'))
      return null
    } finally {
      setChecking(false)
    }
  }

  /** 表の「…」：この店を外す／この店に送る（問題の無い店だけ戻せる）。 */
  const toggleExclude = async (p: HqBroadcastPreflight) => {
    if (!run || !checks) return
    const ids = checks.filter((c) => (c.accountId === p.accountId ? !p.excluded : c.excluded)).map((c) => c.accountId)
    try {
      const next = (await hqBroadcastsApi.exclude(run.id, ids, run.version)).data
      setRun(next)
      setChecks(checks.map((c) => ({ ...c, excluded: ids.includes(c.accountId) })))
      setExcluded(ids)
      setRunKey(JSON.stringify({ ...input, excludedAccountIds: ids.filter((id) => accountIds.includes(id)) }))
    } catch (caught) {
      setError(errorText(caught, 'アカウントを外せませんでした。もう一度お試しください。'))
    }
  }

  const saveDraft = async () => {
    const result = await check()
    if (result) notifyToast('下書きに保存しました')
  }

  /*
   * 送る（⑤ の主ボタン）。送る人数が多いときは承認が要る（API-18）：
   * 2人以上の運用は「承認を依頼する」→ 承認されたら送る。1人運用は確かめの窓で人数を入れる。
   */
  const askSend = async () => {
    const result = !run || stale || !checks ? await check() : { run, checks }
    if (!result) return
    if (sendTotals(result.checks).sendStores === 0) { setError('送れるアカウントがありません。外したアカウントの問題を直すか、送るアカウントを変えてください。'); return }
    let state = approval.state
    try { state = (await hqBroadcastsApi.approval(result.run.id)).data } catch { /* 読めなければ口が送るときに止める。 */ }
    const nextGate = approvalGate(state)
    approval.reload()
    if (nextGate === 'needsRequest') { setApprovalRequestOpen(true); return }
    if (nextGate === 'pending') { setError('承認を待っています。承認されると送れます。'); setErrorStep(null); return }
    setConfirmCount('')
    setConfirmOpen(true)
  }

  const send = async () => {
    if (!run) return
    setSending(true)
    try {
      await (gate === 'single' ? hqBroadcastsApi.send(run.id, run.version, Number(confirmCount)) : hqBroadcastsApi.send(run.id, run.version))
      setConfirmOpen(false)
      notifyToast(when === 'now' ? '一括配信を送り始めました' : '一括配信を予約しました')
      setLeaving(true)
      router.push(`/hq/broadcasts/detail?id=${encodeURIComponent(run.id)}`)
    } catch (caught) {
      setConfirmOpen(false)
      setError(errorText(caught, '送れませんでした。もう一度確かめてください。'))
      setRunKey('')
    } finally {
      setSending(false)
    }
  }

  /** ① 配信方法「テンプレートを選択」・③［テンプレートから選ぶ］：統括のメッセージのひな形を開いている吹き出しに読み込む。 */
  const applyTemplate = async (id: string) => {
    if (!id) return
    try {
      const detail = await hqTemplatesApi.get(id)
      if (detail.template.template_type !== 'template') return
      const read = bubbleFromTemplate(id, detail.definition as MessageTemplateDefinition)
      if ('error' in read) { setError(read.error); setErrorStep('basic'); return }
      setBubbles([{ ...read.bubble, body: read.bubble.body.slice(0, BODY_MAX) }]); setOpenBubble(0)
      if (!title.trim()) setTitle((detail.definition as MessageTemplateDefinition).template.name.slice(0, TITLE_MAX))
      setTemplateId(id); setError(''); setErrorStep(null)
    } catch (caught) {
      setError(errorText(caught, 'ひな形を読み込めませんでした。もう一度お試しください。')); setErrorStep('basic')
    }
  }
  /** ③ カルーセル：統括のカルーセルのひな形を読み、中身（カード）を吹き出しに控える。 */
  const chooseCarousel = async (id: string) => {
    setCarouselError('')
    if (!id) { setContent({}); return }
    try {
      const detail = await hqTemplatesApi.get(id)
      if (detail.template.template_type !== 'template') return
      const read = bubbleFromTemplate(id, detail.definition as MessageTemplateDefinition)
      if ('error' in read || read.bubble.kind !== 'carousel') { setCarouselError('error' in read ? read.error : 'カルーセルのテンプレートを選んでください'); return }
      setContent(read.bubble.content, read.bubble.cardAsset)
    } catch (caught) {
      setCarouselError(errorText(caught, 'カルーセルを読み込めませんでした。もう一度お試しください。'))
    }
  }
  /** ③［テンプレートから選ぶ］：選んだひな形で開いている吹き出しを置き換える。読めない種類は窓の中に理由を出す。 */
  const pickTemplate = async (id: string): Promise<string | null> => {
    try {
      const detail = await hqTemplatesApi.get(id)
      if (detail.template.template_type !== 'template') return 'メッセージのテンプレートを選んでください'
      const read = bubbleFromTemplate(id, detail.definition as MessageTemplateDefinition)
      if ('error' in read) return read.error
      replaceActive({ ...read.bubble, body: read.bubble.body.slice(0, BODY_MAX) })
      setCarouselError('')
      return null
    } catch (caught) {
      return errorText(caught, 'テンプレートを読み込めませんでした。もう一度お試しください。')
    }
  }
  useEffect(() => {
    if (method !== 'template' || templates) return
    let current = true
    void hqTemplatesApi.listByKind().then((list) => { if (current) setTemplates(list) }).catch(() => { if (current) setTemplates([]) })
    return () => { current = false }
  }, [method, templates])

  /** ① 最近の配信・「過去の配信を複製」：配信名・中身・送るアカウント・対象を写す（時刻と下書きは写さない）。 */
  /**
   * ① 最近の配信・「過去の配信を複製」・詳細の［複製して作る］：配信名に「（コピー）」を付け、中身（吹き出し）・フォルダ・社内メモを写す。
   * 宛先（送るアカウント・対象）と日時は写さない（RqYwI・オーナー 10-08）。
   */
  const duplicate = (source: HqBroadcastRun) => {
    const saved = source.input
    setMethod('duplicate')
    setCopiedId(source.id)
    setTitle(`${saved.title}（コピー）`.slice(0, TITLE_MAX))
    setFolderId(saved.folderId ?? '')
    setInternalMemo(saved.internalMemo ?? '')
    setBubbles(bubblesFromInput(saved)); setOpenBubble(0)
    notifyToast(`「${saved.title}」の中身を写しました`)
  }

  const insert = (label: string) => {
    const el = bodyRef.current
    const at = el?.selectionStart ?? body.length
    setBody((text) => `${text.slice(0, at)}${label}${text.slice(at)}`.slice(0, BODY_MAX))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + label.length, at + label.length) })
  }

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: !leaving && (body.trim().length > 0 || title.trim().length > 0 || accountIds.length > 0),
    busy: checking || sending,
    samePage: (url) => url.pathname === '/hq/broadcasts/new',
  })

  const visibleStores = (stores ?? []).filter((s) => folderFilter === ALL || (folderFilter === UNFILED ? !s.folderId : s.folderId === folderFilter))
  const unfiledCount = (stores ?? []).filter((s) => !s.folderId).length
  const friendTotal = chosen.filter((s) => !excluded.includes(s.id)).reduce((sum, s) => sum + s.friendCount, 0)
  const totals = checks && !stale ? sendTotals(checks) : null
  const peopleLabel = totals ? `${formatNumber(totals.sendPeople)}人` : audience === 'all' && chosen.length > 0 ? `${formatNumber(friendTotal)}人` : '—人'
  const audienceLabel = audience === 'tag' ? (tagName ? `タグ：${tagName}` : 'タグ：未選択')
    : audience === 'scenario' ? (scenarioName ? `シナリオ「${scenarioName}」を購読中` : 'シナリオ購読中の全員')
    : audience === 'advanced' ? (savedName ? `保存した条件「${savedName}」${pruneCondition(condition) ? '＋詳細条件' : ''}` : pruneCondition(condition) ? '詳細条件' : '詳細条件：未設定')
    : '友だち全員'
  const audienceFull = `${audienceLabel}${excludeTag ? `・タグ「${excludeTag}」を除く` : ''}`
  const bubblesDone = bubbles.every((item) => !hqBubbleProblem(item))
  const bubbleSummary = hqBubbleSummary
  const accountsLabel = chosen.length === 0 ? '未選択' : chosen.length <= 2 ? chosen.map((s) => s.name).join('・') : `${chosen[0].name} ほか ${chosen.length - 1}アカウント`
  const sendWhenLabel = when === 'now' ? '今すぐ' : scheduledAt ? jpDateTime(scheduledAt) : '未設定'
  const { shown, rest } = splitPreflightRows(checks ?? [], showAll ? Infinity : ROWS_SHOWN)
  const exampleStore = (checks ?? []).find((p) => !p.excluded && !p.blockedReasons.length)?.accountName ?? chosen[0]?.name ?? '店の名前'
  const previewBubbles = bubbles.map((item) => previewBubbleOf(item, previewText(item.body, exampleStore)))
  const steps = broadcastSteps({
    basicDone: Boolean(title.trim()) && title.trim().length <= TITLE_MAX,
    audienceDone: chosen.length > 0 && (audience === 'all' || audience === 'scenario' || (audience === 'tag' && Boolean(tagName)) || (audience === 'advanced' && (Boolean(pruneCondition(condition)) || Boolean(savedName)))),
    messageDone: bubblesDone,
    scheduleDone: when === 'now' || Boolean(scheduledAt),
  })
  const stepIndex = STEP_ORDER.indexOf(step)
  const draftLabel = savedAt ? `下書き保存済み・${formatRelative(savedAt)}` : draftState === 'ready' ? '保存済みの下書きを開いています' : '下書き・未保存'

  /** ［保存してテンプレート化する］：開いている吹き出しを統括のひな形（メッセージ）として保存する。 */
  const saveAsTemplate = async () => {
    const name = saveTplName.trim()
    if (!name) { setSaveTplError('テンプレートの名前を入れてください'); return }
    const made = templateContentOfBubble(active, name)
    if ('error' in made) { setSaveTplError(made.error); return }
    setSaveTplBusy(true); setSaveTplError('')
    try {
      const definition = hostDefinition(freshDefinition('template') as MessageTemplateDefinition, made.content)
      await hqTemplatesApi.create({ type: 'template', name, definition }, crypto.randomUUID())
      setSaveTplOpen(false)
      setTemplates(null); setCarousels(null)
      notifyToast(`テンプレート「${name}」に保存しました`)
    } catch (caught) {
      setSaveTplError(errorText(caught, 'テンプレートに保存できませんでした。もう一度お試しください。'))
    } finally {
      setSaveTplBusy(false)
    }
  }

  if (composer && canManage) {
    /* 店のカルーセル・リッチメッセージの作る部品をそのまま使う（統括のテンプレートと同じ host の口）。保存は吹き出しに入れるだけ。 */
    const host: TemplateEditHost = {
      backHref: '/hq/broadcasts',
      description: '作った中身は、この一括配信のメッセージに入ります（テンプレートには残りません）',
      folders: [],
      folder: '',
      onFolderChange: () => {},
      busy: false,
      primaryLabel: 'メッセージに入れる',
      initialContent: hostContentOfBubble(active),
      onSave: (content) => {
        const next = bubbleFromHostContent(content)
        if (next) { replaceActive(next); setCarouselError('') }
        setComposer(null)
      },
      onCancel: () => setComposer(null),
      uploadRichImage: (file) => hqTemplatesApi.uploadRichMessageImage(file),
    }
    return composer === 'carousel' ? <CarouselV8 host={host} /> : <TemplateRichEditor host={host} />
  }

  if (!canManage) {
    return (
      <div className={formStyles.root}>
        <header className={formStyles.header}>
          <div className={formStyles.heading}>
            <Button variant="secondary" className={formStyles.textButton} size="compact" href="/hq/broadcasts">← 一括配信一覧</Button>
            <h2>一括配信を作る</h2>
          </div>
        </header>
        <div className={formStyles.input}>
          <Notice tone="info">一括配信を作れるのは、統括全体の編集権限がある人（オーナー・管理者）だけです。</Notice>
        </div>
      </div>
    )
  }

  const shows = (key: BroadcastStepKey) => step === key
  const nextLabel = step === 'basic' ? '対象設定へ' : step === 'audience' ? 'メッセージ設定へ' : step === 'message' ? '送信設定へ' : '配信前チェックへ'

  return (
    <>
      <div className={formStyles.root} data-step={step} data-hq-broadcast-create="">
        <header className={formStyles.header} data-steps-below="">
          <div className={formStyles.heading}>
            <Button variant="secondary" className={formStyles.textButton} size="compact" href="/hq/broadcasts">← 一括配信一覧</Button>
            <h2>一括配信を作る</h2>
            <p aria-live="polite">{draftLabel}</p>
          </div>
          {/* 手順は題と説明のすぐ下・左寄せ・1行（型の共通部品 Steps・Fa8ED / q1xNMz）。 */}
          <div className={formStyles.stepsBelow}><Steps label="配信作成の進み" steps={steps.map((item) => ({ ...item, onSelect: () => changeStep(item.key) }))} currentKey={step} /></div>
          <Button aria-expanded={previewOpen} aria-controls="hq-broadcast-line-preview" className={formStyles.previewToggle} onClick={() => setPreviewOpen(true)}><Eye size={14} aria-hidden /> LINEの見え方</Button>
        </header>
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            action={errorStep && errorStep !== step ? (
              <Button variant="secondary" size="compact" onClick={() => changeStep(errorStep)}>{`${steps[STEP_ORDER.indexOf(errorStep)].label}へ移動`}</Button>
            ) : undefined}
          >
            {error}
          </Notice>
        ) : null}
        {draftState === 'loading' ? <Notice tone="info" role="status">下書きを読み込んでいます…</Notice> : null}
        {draftState === 'sent' ? (
          <Notice tone="warn" role="alert" action={<Button size="compact" href={`/hq/broadcasts/detail?id=${encodeURIComponent(params.get('id') ?? '')}`}>詳細を見る</Button>}>
            この一括配信はもう送った（予約した）ので直せません。新しく作るときは、送るアカウントと中身を入れてください。
          </Notice>
        ) : null}
        {draftState === 'error' ? <Notice tone="danger" role="alert">下書きを読み込めませんでした。一括配信の一覧から開き直してください。</Notice> : null}

        <div className={formStyles.body}>
          <div className={formStyles.input}>
            {/* ① 基本設定（lmWCZ） */}
            {shows('basic') ? (
              <section id="broadcast-step-basic" className={formStyles.section}>
                <h3>配信方法</h3>
                <RadioCardGroup legend="配信方法" className={formStyles.methodCards}>
                  {([
                    ['new', '新しいメッセージを作成', 'テキスト・画像・カルーセルなどを組み合わせて一から作ります。'],
                    ['template', 'テンプレートを選択', '統括のテンプレートを呼び出して手直しします。'],
                    ['duplicate', '過去の配信を複製', '送った一括配信をそのまま写して作り直します。'],
                  ] as const).map(([value, label, note]) => (
                    <RadioCard key={value} name="hq-broadcast-method" value={value} checked={method === value} title={label} note={note} onChange={(next) => setMethod(next as Method)} />
                  ))}
                </RadioCardGroup>
                {/* RqYwI（オーナー 10-08）：「テンプレートを選択」「過去の配信を複製」を選んだら、下に選ぶ一覧。選ぶと右の見え方がその中身になる。 */}
                {method === 'template' ? (
                  <div className={styles.pickList} data-design-node="RqYwI">
                    <div className={styles.pickHead}>
                      <h3>テンプレートを選ぶ</h3>
                      <SearchField aria-label="テンプレートを名前で探す" placeholder="名前で探す" value={templateQuery} onChange={setTemplateQuery} onClear={() => setTemplateQuery('')} />
                    </div>
                    {templates === null ? <ListState kind="loading" /> : templates.length === 0 ? (
                      <p className={styles.pickNote}>統括のテンプレートがまだありません。統括の「テンプレート」で作れます。</p>
                    ) : (
                      <RadioCardGroup legend="テンプレートを選ぶ" className={styles.pickCards}>
                        {templates.filter((t) => !templateQuery.trim() || t.name.includes(templateQuery.trim())).map((t) => (
                          <RadioCard key={t.id} name="hq-broadcast-template" value={t.id} checked={templateId === t.id} title={t.name}
                            note={[TEMPLATE_KIND_NAME[t.kind ?? 'message'] ?? 'メッセージ', t.content_summary, t.updated_at ? `更新 ${shortDate(t.updated_at)}` : ''].filter(Boolean).join('・')}
                            onChange={() => void applyTemplate(t.id)} />
                        ))}
                      </RadioCardGroup>
                    )}
                    <p className={styles.pickNote}>選ぶと右の「LINE での見え方」がその中身に変わります。次の「メッセージを作成」で手直しできます。</p>
                  </div>
                ) : null}
                {method === 'duplicate' ? (
                  <div className={styles.pickList} data-design-node="RqYwI">
                    <div className={styles.pickHead}><h3>写す配信を選ぶ</h3></div>
                    {sentRuns === null ? <ListState kind="loading" /> : sentRuns.length === 0 ? (
                      <p className={styles.pickNote}>送った一括配信はまだありません。</p>
                    ) : (
                      <RadioCardGroup legend="写す配信を選ぶ" className={styles.pickCards}>
                        {sentRuns.map((item) => (
                          <RadioCard key={item.id} name="hq-broadcast-copy" value={item.id} checked={copiedId === item.id} title={item.title}
                            note={`${shortDate(item.scheduledAt)} 送信・${formatNumber(runPeople(item))}人・${runKinds(item)}`}
                            onChange={() => duplicate(item)} />
                        ))}
                      </RadioCardGroup>
                    )}
                    <p className={styles.pickNote}>選ぶと右の見え方がその配信の中身になります。配信名は「（コピー）」付きで入ります。宛先と日時は写しません。</p>
                  </div>
                ) : null}
                <label className={formStyles.nameField}>
                  <span className={formStyles.labelRow}><span className="text-ink text-sm font-bold">配信名<RequiredBadge /></span><span className="text-xs text-ink-faint">{title.trim().length} / {TITLE_MAX}文字</span></span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className={formStyles.textInput} aria-label="配信名" maxLength={TITLE_MAX * 2} />
                  <small>友だちには表示されません。一覧で見分けるための名前です</small>
                </label>
                {/* 店の一斉配信と同じフォルダ・社内メモ（統括の一括配信のフォルダ。API-18） */}
                <div className={formStyles.basicFields}>
                  <label><span className={formStyles.labelRow}>フォルダ</span><FolderSelect aria-label="フォルダ" value={folderId} onChange={setFolderId} folders={hqFolders.map((f) => ({ value: f.id, label: f.name }))} onCreate={canManage ? createHqFolder : undefined} colors={false} size="full" /></label>
                  <label><span className={formStyles.labelRow}>社内メモ <span className="text-ink-faint text-xs font-normal">任意</span><HelpTip label="社内メモの説明">友だちには表示されません。各アカウントの配信にも同じメモが残ります</HelpTip></span><textarea aria-label="社内メモ" value={internalMemo} onChange={(event) => setInternalMemo(event.target.value)} rows={1} maxLength={10000} className={formStyles.textInput} placeholder="友だちには表示されません" /></label>
                </div>
                <div className={formStyles.recentHeader}><h3>最近の配信</h3><Link href="/hq/broadcasts">一括配信の一覧を見る →</Link></div>
                <div className={formStyles.recentList}>
                  {recent.length ? recent.map((item) => {
                    const people = runPeople(item)
                    return (
                      <div key={item.id} className={formStyles.recentRow}>
                        <Send size={14} aria-hidden /><span className={formStyles.recentName} title={item.title}>{item.title}</span>
                        <span className="text-ink-faint">{jpDateTime(item.scheduledAt)} 送信 ・ {formatNumber(people)}人</span>
                        <Button size="compact" onClick={() => duplicate(item)}>複製する</Button>
                      </div>
                    )
                  }) : <p className="text-xs text-ink-faint">最近の配信はまだありません。</p>}
                </div>
              </section>
            ) : null}

            {/* ② 配信対象（AL5vR）。上に統括だけの「送るアカウント」（J5DH6o）。 */}
            {shows('audience') ? (
              <section id="broadcast-step-audience" className={formStyles.section}>
                <div className={styles.accounts} data-design-node="J5DH6o">
                  <h3>送るアカウント</h3>
                  {loadError && !stores ? <ListState kind="error" error={loadError} onRetry={() => window.location.reload()} /> : !stores ? <ListState kind="loading" /> : (
                    <>
                      <div className={styles.folderChips} role="group" aria-label="フォルダで絞る">
                        <FilterChip selected={folderFilter === ALL} onChange={() => setFolderFilter(ALL)} count={stores.length}>すべて</FilterChip>
                        {folders.map((f) => (
                          <FilterChip key={f.id} selected={folderFilter === f.id} onChange={() => setFolderFilter(folderFilter === f.id ? ALL : f.id)} icon={<FolderDot folder={f} />} count={stores.filter((s) => s.folderId === f.id).length}>{f.name}</FilterChip>
                        ))}
                        {unfiledCount > 0 && folders.length > 0 ? (
                          <FilterChip selected={folderFilter === UNFILED} onChange={() => setFolderFilter(folderFilter === UNFILED ? ALL : UNFILED)} icon={<FolderDot folder={null} />} count={unfiledCount}>未分類</FilterChip>
                        ) : null}
                      </div>
                      <div className={styles.accountCards}>
                        {visibleStores.map((s) => (
                          <CheckCard
                            key={s.id}
                            size="compact"
                            checked={accountIds.includes(s.id)}
                            onChange={(on) => setAccountIds((ids) => (on ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                            title={<span title={s.name}><FolderDotName folder={s.folder}>{s.name}</FolderDotName></span>}
                            note={`友だち ${formatNumber(s.friendCount)} 人`}
                          />
                        ))}
                        {visibleStores.length === 0 ? <p className="text-xs text-ink-faint">このフォルダにアカウントはありません。</p> : null}
                      </div>
                      <p className={styles.accountsNote} aria-live="polite">
                        {chosen.length === 0
                          ? 'アカウントを選んでください。送る相手は、下の条件で各アカウントの友だちから選びます。'
                          : `${formatNumber(chosen.length)} アカウントを選んでいます。送る相手は、下の条件で各アカウントの友だちから選びます。`}
                      </p>
                    </>
                  )}
                </div>
                <h3>配信対象</h3>
                {/* 店の一斉配信と同じ4つ。タグ・シナリオ・保存した条件は、各アカウントの同じ名前のものに直して送る（API-18）。 */}
                <RadioCardGroup legend="配信対象" className={formStyles.audienceCards}>
                  {TARGET_MODES.map((mode) => (
                    <RadioCard
                      key={mode.value}
                      name="hq-broadcast-target"
                      value={mode.value}
                      checked={audience === mode.value}
                      onChange={() => {
                        if (mode.value === 'advanced') { setConditionDraft(condition); setConditionOpen(true) }
                        setAudience(mode.value)
                      }}
                      title={mode.label}
                      note={mode.value === 'tag' ? '選んだタグが付いている人' : mode.value === 'advanced' ? 'タグ・登録日・反応状態など' : mode.value === 'scenario' ? 'いまシナリオが流れている人' : mode.description}
                    />
                  ))}
                </RadioCardGroup>
                {chosen.length === 0 && audience !== 'all' ? <p className="text-xs text-ink-faint">先に送るアカウントを選ぶと、タグ・シナリオ・保存した条件を選べます。</p> : null}
                {tagStatus === 'loading' && audience !== 'all' ? <p className="text-xs text-ink-faint">選んだアカウントのタグ・シナリオを読み込んでいます…</p> : null}
                {tagStatus === 'error' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-warning">タグを読み込めませんでした。通信を確かめて、もう一度お試しください。</p>
                    <Button variant="secondary" size="compact" onClick={() => void loadTags()}>もう一度読み込む</Button>
                  </div>
                ) : null}
                {audience === 'scenario' ? (
                  <div className="border-hairline border-t pt-4">
                    <label className="text-ink-secondary block text-xs font-semibold">どのシナリオ</label>
                    <Combobox
                      aria-label="どのシナリオ"
                      placeholder="すべてのシナリオ（どれか1つでも購読中）"
                      value={scenarioName}
                      onChange={setScenarioName}
                      options={(scenarioOptions ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.accounts}/${chosen.length}アカウント）` }))}
                      loading={tagStatus === 'loading'}
                      disabled={tagStatus !== 'ready' || chosen.length === 0}
                      className="mt-1 w-full sm:max-w-sm"
                    />
                    {scenarioName && (scenarioOptions ?? []).some((t) => t.name === scenarioName && t.accounts < chosen.length) ? (
                      <p className="mt-1 text-xs text-warning">このシナリオが無いアカウントには送りません（最終確認で外します）。</p>
                    ) : null}
                  </div>
                ) : null}
                {audience === 'tag' ? (
                  <div className="border-hairline border-t pt-4">
                    <label className="text-ink-secondary block text-xs font-semibold">含めるタグ</label>
                    <Combobox
                      aria-label="含めるタグ"
                      placeholder="タグを選んでください"
                      value={tagName}
                      onChange={setTagName}
                      options={(tagOptions ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.accounts}/${chosen.length}アカウント）` }))}
                      loading={tagStatus === 'loading'}
                      disabled={tagStatus !== 'ready' || chosen.length === 0}
                      className="mt-1 w-full sm:max-w-sm"
                    />
                    {tagStatus === 'ready' && chosen.length > 0 && (tagOptions ?? []).length === 0 ? <p className="mt-1 text-xs text-ink-faint">選んだアカウントにタグがありません。</p> : null}
                    {tagName && (tagOptions ?? []).some((t) => t.name === tagName && t.accounts < chosen.length) ? (
                      <p className="mt-1 text-xs text-warning">このタグが無いアカウントには送りません（最終確認で外します）。</p>
                    ) : null}
                  </div>
                ) : null}
                {audience === 'advanced' ? (
                  <div className="border-hairline border-t pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-ink">配信対象の条件</p>
                        <p className="mt-1 text-xs text-ink-faint">{pruneCondition(condition) ? '設定した詳細条件で絞り込みます。' : savedName ? '保存した条件で絞り込みます。' : '条件を1つ以上設定するか、保存した条件を選んでください。'}</p>
                      </div>
                      <Button type="button" onClick={() => { setConditionDraft(condition); setConditionOpen(true) }}>条件を編集</Button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-ink-faint text-xs">ブロック中の友だちを自動で除外しています</p>
                  <span className={formStyles.excludeTag}>
                    <Select
                      aria-label="保存した条件から選ぶ"
                      value={savedName}
                      onChange={(value) => { setSavedName(value); if (value) setAudience('advanced') }}
                      disabled={tagStatus !== 'ready' || chosen.length === 0}
                      options={[{ value: '', label: '保存した条件から選ぶ' }, ...(savedOptions ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.accounts}/${chosen.length}アカウント）` }))]}
                      size="full"
                    />
                  </span>
                </div>
                <div className={formStyles.exclusion}>
                  <Checkbox checked onCheckedChange={() => {}} disabled>ブロック中の人を除く</Checkbox>
                  <small>ブロック中・非表示・宛先不明の友だちには送りません</small>
                </div>
                <label className={formStyles.excludeTag}><span className={formStyles.labelRow}>除くタグ <span className="text-xs text-ink-faint">任意</span></span><Select aria-label="除くタグ" value={excludeTag} onChange={setExcludeTag} disabled={tagStatus !== 'ready' || chosen.length === 0} options={[{ value: '', label: '除外なし' }, ...(tagOptions ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.accounts}/${chosen.length}アカウント）` }))]} size="full" /></label>
                <div className={formStyles.exclusion}>
                  <Checkbox checked={false} onCheckedChange={() => {}} disabled>この1週間に送った人を除く</Checkbox>
                  <small>最近送った人を除く機能は、まだ使えません</small>
                </div>
                <div className={formStyles.audienceCount} aria-live="polite"><span><Send size={14} aria-hidden /> この条件で送る人数</span><strong>{peopleLabel}</strong></div>
                {audience !== 'all' && !totals ? <p className="text-xs text-ink-faint">絞った人数は、最終確認でアカウントごとに数えます</p> : null}
                <Notice tone="info"><strong>対象の確認ポイント</strong><br />人数は送る直前にもう一度数え直します。ブロック中の人には送りません</Notice>
              </section>
            ) : null}

            {/* ③ メッセージを作成（lLyFR） */}
            {shows('message') ? (
              <section id="broadcast-step-message" className={formStyles.section}>
                <div className={styles.messageHead}>
                  <h3>{`メッセージ（${Math.min(openBubble, bubbles.length - 1) + 1} / ${bubbles.length}）`}</h3>
                  {/* 絵 lLyFR：見出しの右に［テンプレートから選ぶ］［保存してテンプレート化する］（開いている吹き出しを統括のひな形に保存）。 */}
                  <span className={styles.messageHeadActions}>
                    <Button size="compact" onClick={() => setPickerOpen(true)}>テンプレートから選ぶ</Button>
                    <Button size="compact" onClick={() => { setSaveTplName(String(active.content.templateName ?? active.content.assetName ?? '') || title.trim()); setSaveTplError(''); setSaveTplOpen(true) }}><Save size={14} aria-hidden /> 保存してテンプレート化する</Button>
                  </span>
                </div>
                {/* 店の一斉配信と同じく吹き出しは5つまで。開いているのは1つで、ほかは1行の要約（API-18 の複数の吹き出し）。 */}
                {bubbles.map((item, index) => (
                  <details key={item.id} className={formStyles.bubbleFrame} data-embedded open={index === Math.min(openBubble, bubbles.length - 1)}>
                    <summary onClick={(event) => { event.preventDefault(); setOpenBubble(index) }}>
                      <span className={formStyles.bubbleNumber}>{index + 1}</span>
                      <span title={bubbleSummary(item)}>{index === Math.min(openBubble, bubbles.length - 1) ? KIND_LABEL[item.kind] : bubbleSummary(item)}</span>
                      <span className={formStyles.bubbleControls} onClick={(event) => { event.preventDefault(); event.stopPropagation() }}>
                        <Button size="compact" aria-label={`${index + 1}通目を上へ移動`} disabled={index === 0} onClick={() => { setBubbles((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next }); setOpenBubble(index - 1) }}><ArrowUp size={12} aria-hidden /></Button>
                        <Button size="compact" aria-label={`${index + 1}通目を下へ移動`} disabled={index === bubbles.length - 1} onClick={() => { setBubbles((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next }); setOpenBubble(index + 1) }}><ArrowDown size={12} aria-hidden /></Button>
                        <Button size="compact" aria-label={`${index + 1}通目を削除する`} disabled={bubbles.length === 1} onClick={() => { setBubbles((items) => items.filter((_, i) => i !== index)); setOpenBubble(0) }}><Trash2 size={12} aria-hidden /></Button>
                      </span>
                    </summary>
                    {index === Math.min(openBubble, bubbles.length - 1) ? (
                      <>
                        <div className="flex flex-wrap gap-2" role="tablist" aria-label={bubbles.length > 1 ? `${index + 1}通目のメッセージの形式` : 'メッセージの形式'}>
                          {HQ_KIND_TABS.map(([value, label]) => (
                            <button key={value} type="button" role="tab" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1} className="broadcast-message-type" data-active={kind === value || undefined}
                              title={HQ_NOT_YET.has(value) ? notYetText(value) : value === 'coupon' ? 'クーポン' : undefined}
                              onClick={() => { if (kind !== value) setKind(value) }}>{label}</button>
                          ))}
                        </div>
                        {kind === 'text' ? (
                          <section>
                            <InsertTextField
                              ref={bodyRef}
                              aria-label="本文"
                              rows={6}
                              maxLength={BODY_MAX}
                              value={body}
                              onValueChange={setBody}
                              extraTokens={STORE_INSERT_CHIPS}
                              placeholder="{店名}より：…"
                              className="border-hairline rounded-control w-full resize-none border p-3 text-sm focus:border-accent focus:outline-none"
                            />
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className={styles.inserts}>
                                <span className="text-ink-faint">差し込む：</span>
                                {STORE_INSERTS.map((item) => (
                                  <InsertButton key={item.label} label={item.label.slice(1, -1)} title={item.help} onClick={() => insert(item.label)} />
                                ))}
                              </span>
                              <span className="text-ink-faint">{`${formatNumber(body.length)} / ${formatNumber(BODY_MAX)}`}</span>
                            </div>
                            <p className="mt-2 text-xs text-ink-faint">{'{店名}・{店の電話番号}・{予約ページ} は、送るアカウントの名前と共通情報に置き換わります。共通情報が無いアカウントは最終確認で外します。'}</p>
                          </section>
                        ) : HQ_NOT_YET.has(kind) ? (
                          <p className={styles.notYet} role="note">{notYetText(kind)}</p>
                        ) : kind === 'image' || kind === 'video' ? (
                          /* 店の一斉配信と同じアップロード欄。置き場はどの店にも属さない（統括）ので、どのアカウントからも同じ URL で届く。 */
                          <MediaUpload bubble={{ id: active.id, type: kind, content: active.content }} lineAccountId={null} onChange={(next) => setContent(next)} />
                        ) : kind === 'audio' || kind === 'sticker' || kind === 'location' ? (
                          <MessageKindFields
                            kind={kind as MessageKind}
                            value={(active.content.state as MessageKindState | undefined) ?? emptyMessageKindState()}
                            onChange={(next) => setContent({ state: next })}
                          />
                        ) : kind === 'flex' ? (
                          /* 統括のメッセージのひな形（画像・ボタンつきのカード）。中身はひな形のまま送る。直すときは統括のテンプレートで。 */
                          <section>
                            <p className="text-xs text-ink-secondary">{`テンプレート「${String(active.content.templateName ?? '')}」のカードをそのまま送ります。中身を直すときは統括の「テンプレート」で直してから選び直してください。`}</p>
                            {hqBubbleProblem(active) ? <p className="mt-2 text-xs text-warning" role="alert">{hqBubbleProblem(active)}</p> : null}
                          </section>
                        ) : kind === 'carousel' ? (
                          <section>
                            {/* 統括のカルーセルのひな形（コンテンツ ＞ テンプレート ＞ カルーセル）から選ぶ。中身そのものを控えるので、ひな形を消しても送れる。 */}
                            {carousels === null ? <p className="text-xs text-ink-faint">読み込んでいます…</p> : carousels.length === 0 ? (
                              <p className="text-xs text-ink-faint">統括のカルーセルのテンプレートがありません。「テンプレート」でカルーセルを作ってください。</p>
                            ) : (
                              <Select
                                aria-label="カルーセルを選ぶ"
                                value={String(active.content.hqTemplateId ?? active.content.assetId ?? '')}
                                onChange={(id) => void chooseCarousel(id)}
                                size="full"
                                options={[{ value: '', label: '選んでください' }, ...carousels.map((t) => ({ value: t.id, label: t.name }))]}
                              />
                            )}
                            <div className={styles.composeRow}>
                              {active.content.templateName || active.content.assetName ? <span>{`カード${carouselColumns(active).length}枚`}</span> : <span>ひな形が無ければ、ここで作れます</span>}
                              <Button size="compact" onClick={() => setComposer('carousel')}><Plus size={14} aria-hidden /> {hostContentOfBubble(active) ? 'このカルーセルを直す' : 'カルーセルをその場で作る'}</Button>
                            </div>
                            {carouselError ? <p className="mt-2 text-xs text-warning" role="alert">{carouselError}</p> : (active.content.templateName || active.content.assetName) && hqBubbleProblem(active) ? <p className="mt-2 text-xs text-warning" role="alert">{hqBubbleProblem(active)}</p> : null}
                          </section>
                        ) : (
                          <section>
                            {kind === 'coupon' ? <p className="mb-2 text-xs text-ink-faint">その他の種類：クーポン</p> : null}
                            {assets === null ? <p className="text-xs text-ink-faint">読み込んでいます…</p> : kindAssets.length === 0 ? (
                              <p className="text-xs text-ink-faint">{`統括で使える${KIND_LABEL[kind]}がありません。「コンテンツ ＞ テンプレート」で、どの店にも属さない素材として作ってください。`}</p>
                            ) : (
                              <Select
                                aria-label={`${KIND_LABEL[kind]}を選ぶ`}
                                value={assetId}
                                onChange={setAssetId}
                                size="full"
                                options={[{ value: '', label: '選んでください' }, ...kindAssets.map((a) => ({ value: a.id, label: a.name }))]}
                              />
                            )}
                            {kind === 'rich' ? (
                              <div className={styles.composeRow}>
                                <span>{active.media?.length ? `その場で作ったリッチメッセージ：${String(active.content.assetName ?? '')}` : '素材が無ければ、ここで作れます'}</span>
                                <Button size="compact" onClick={() => setComposer('rich')}><Plus size={14} aria-hidden /> {active.media?.length ? 'このリッチメッセージを直す' : 'リッチメッセージをその場で作る'}</Button>
                              </div>
                            ) : null}
                            {assetId && hqBubbleProblem(active) ? <p className="mt-2 text-xs text-warning" role="alert">{hqBubbleProblem(active)}</p> : null}
                          </section>
                        )}
                      </>
                    ) : null}
                  </details>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" disabled={bubbles.length >= MAX_BUBBLES} onClick={() => { setBubbles((items) => [...items, newBubble('text')]); setOpenBubble(bubbles.length) }}><Plus size={15} aria-hidden /> メッセージを追加する</Button>
                  <span className="text-xs text-ink-faint">{bubbles.length >= MAX_BUBBLES ? '5つまでです' : `あと${MAX_BUBBLES - bubbles.length}つ`}</span>
                </div>
              </section>
            ) : null}

            {/* ④ 送信設定（ZU4Ae） */}
            {shows('schedule') ? (
              <section id="broadcast-step-schedule" className={formStyles.section}>
                <h3>配信日</h3>
                <RadioCardGroup legend="配信日" className={formStyles.methodCards}>
                  <RadioCard name="hq-broadcast-send-mode" value="now" checked={when === 'now'} onChange={() => setWhen('now')} title="今すぐ配信" note="⑤の確認で「今すぐ送る」を押すと、確認の小窓のあとすぐに送ります" />
                  <RadioCard name="hq-broadcast-send-mode" value="later" checked={when === 'later'} onChange={() => setWhen('later')} title="日時を指定して予約" note="決めた日時に、全アカウント同じ時刻で送ります" />
                </RadioCardGroup>
                {when === 'later' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="hq-bc-date" className="text-ink-secondary mb-1 block text-xs font-medium">送る日</label>
                      <DateField id="hq-bc-date" value={date} onChange={setDate} aria-label="送る日" />
                    </div>
                    <div>
                      <label htmlFor="hq-bc-time" className="text-ink-secondary mb-1 block text-xs font-medium">時刻（日本時間）</label>
                      <TimeField id="hq-bc-time" value={time} onChange={setTime} aria-label="時刻（日本時間）" />
                    </div>
                  </div>
                ) : null}
                <div className={formStyles.quota}>
                  <div className={formStyles.quotaHead}><strong>送信枠</strong><HelpTip label="送信枠の説明">LINE公式アカウントの月間送信枠です。アカウントごとに数えます</HelpTip><span>{totals ? `送る ${formatNumber(totals.sendPeople)}通` : 'アカウントごと'}</span></div>
                  <p>今月の残りは最終確認でアカウントごとに確かめます。足りないアカウントは外して送ります</p>
                </div>
              </section>
            ) : null}

            {/* ⑤ 最終確認（H9eG3n）＋統括だけのアカウントごとの確かめ */}
            {shows('confirm') ? (
              <div id="broadcast-step-confirm" className={formStyles.section}>
                <h3>配信前チェック</h3>
                <div className={formStyles.checkList}>
                  {([
                    { key: 'basic', label: '配信名', value: title.trim() || '配信名を入力してください', done: steps[0].state === 'done' || Boolean(title.trim()), move: '基本設定へ戻る' },
                    { key: 'audience', label: '送るアカウント・配信対象', value: `${accountsLabel} ・ ${audienceFull} ・ ${peopleLabel}（ブロック中の人を除く）`, done: steps[1].state === 'done' || (chosen.length > 0 && (audience === 'all' || audience === 'scenario' || (audience === 'tag' && Boolean(tagName)) || (audience === 'advanced' && (Boolean(pruneCondition(condition)) || Boolean(savedName))))), move: '対象者へ戻る' },
                    { key: 'message', label: 'メッセージ', value: `${bubbles.length > 1 ? `${bubbles.length}件` : KIND_LABEL[kind]} ・ ${previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}`, done: bubblesDone && previewConfirmed, move: 'メッセージへ戻る' },
                    { key: 'schedule', label: '送信設定', value: sendWhenLabel, done: when === 'now' || Boolean(scheduledAt), move: '送信設定へ戻る' },
                  ] as const).map((row) => (
                    <div className={formStyles.checkRow} key={row.key}>
                      {row.done ? <CheckCircle2 size={18} className="text-success" aria-hidden /> : <AlertTriangle size={18} className="text-warning" aria-hidden />}
                      <div><strong>{row.label}</strong><p>{row.value}</p></div>
                      <Button variant="secondary" className={formStyles.textButton} size="compact" onClick={() => changeStep(row.key)}>{row.move}</Button>
                    </div>
                  ))}
                </div>
                {(() => {
                  const left = [title.trim(), steps[1].state === 'done', bubblesDone && previewConfirmed, when === 'now' || scheduledAt].filter((ok) => !ok).length
                  return (
                    <Notice tone={left ? 'warn' : 'info'}>
                      {left ? `${left}件の確認が残っています` : '配信する内容を確認してください'}
                    </Notice>
                  )
                })()}
                <h3>アカウントごとの確かめ</h3>
                {!checks || stale ? (
                  <div className={styles.checkEmpty}>
                    <span className="text-xs text-ink-faint">{stale ? '中身・送るアカウント・時刻を変えました。もう一度確かめてください。' : '送る人数・今月の送信枠の残り・LINE の接続・配信を止めていないかを、アカウントごとに確かめます。'}</span>
                    <Button onClick={() => void check()} busy={checking} busyLabel="確かめています…">送る前に確かめる</Button>
                  </div>
                ) : (
                  <>
                    <DataTable className={styles.table} data-design="hq-broadcast-preflight">
                      <thead>
                        <TableHeadRow className={styles.headRow}>
                          <Th className={styles.colStore}>アカウント</Th>
                          <Th className={styles.colPeople}>送る人数</Th>
                          <Th className={styles.colQuota}>今月の送信枠の残り</Th>
                          <Th className={styles.colCheck}>確かめ</Th>
                          <Th className={styles.colSend}>送るか</Th>
                          <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
                        </TableHeadRow>
                      </thead>
                      <tbody>
                        {shown.map((p) => {
                          const badge = preflightBadge(p, body)
                          const go = !p.excluded && p.blockedReasons.length === 0
                          return (
                            <Tr key={p.accountId} className={styles.row}>
                              <Td className={styles.colStore}><span className={styles.store} title={p.accountName}>{p.accountName}</span></Td>
                              <Td className={styles.colPeople}><span className={styles.num}>{p.audienceCount === null ? '—' : `${formatNumber(p.audienceCount)}人`}</span></Td>
                              <Td className={styles.colQuota}><span className={styles.sub}>{p.remaining === null ? '—' : `${formatNumber(p.remaining)}通`}</span></Td>
                              <Td className={styles.colCheck}><StatusBadge tone={badge.tone} title={p.blockedReasons.join('・') || undefined}>{badge.label}</StatusBadge></Td>
                              <Td className={styles.colSend}><StatusBadge tone={go ? 'success' : 'neutral'}>{go ? '送る' : '外す'}</StatusBadge></Td>
                              <Td className={styles.colMenu}>
                                <RowMenu
                                  subjectName={p.accountName}
                                  items={p.blockedReasons.length > 0
                                    ? [{ id: 'why', label: `外す理由：${p.blockedReasons.join('・')}`, disabled: true, disabledReason: '直すと次から送れます', onSelect: () => {} }]
                                    : [{ id: 'toggle', label: p.excluded ? 'このアカウントに送る' : 'このアカウントを外す', onSelect: () => void toggleExclude(p) }]}
                                />
                              </Td>
                            </Tr>
                          )
                        })}
                        {rest.length > 0 ? (
                          <Tr className={styles.row}>
                            <Td className={styles.colStore}><span className={styles.store}>{`ほか ${rest.length}アカウント`}</span></Td>
                            <Td className={styles.colPeople}><span className={styles.num}>{`${formatNumber(rest.reduce((sum, p) => sum + (p.audienceCount ?? 0), 0))}人`}</span></Td>
                            <Td className={styles.colQuota}><span className={styles.sub}>—</span></Td>
                            <Td className={styles.colCheck}><StatusBadge tone="success">すべて足りる</StatusBadge></Td>
                            <Td className={styles.colSend}><StatusBadge tone="success">送る</StatusBadge></Td>
                            <Td className={styles.colMenu}>
                              <RowMenu subjectName={`ほか ${rest.length}アカウント`} items={[{ id: 'all', label: '1つずつ見る', onSelect: () => setShowAll(true) }]} />
                            </Td>
                          </Tr>
                        ) : null}
                      </tbody>
                    </DataTable>
                    {totals ? (
                      <p className={styles.totals}>
                        <span className={styles.totalSend}>{`送る：${formatNumber(totals.sendStores)}アカウント・${formatNumber(totals.sendPeople)}人`}</span>
                        <span className={styles.totalSkip}>{`外す：${formatNumber(totals.skipStores)}アカウント・${formatNumber(totals.skipPeople)}人`}</span>
                      </p>
                    ) : null}
                  </>
                )}
                {run && checks && !stale ? (
                  <HqApprovalBlock
                    run={run}
                    approval={approval}
                    requestOpen={approvalRequestOpen}
                    onRequestClose={() => setApprovalRequestOpen(false)}
                    onChanged={() => { void hqBroadcastsApi.get(run.id).then((res) => { setRun(res.data); setRunKey(key) }).catch(() => undefined) }}
                    scheduledLabel={scheduledAt ? jpDateTime(scheduledAt) : null}
                    messageSummary={`${bubbles.length}通`}
                  />
                ) : null}
                <p className="text-xs text-ink-faint">{when === 'later' ? '予約後も送る前までは、一括配信の詳細から止められます。' : '「今すぐ送る」で確認の小窓を開き、そこで送ると友だちに届きます。送信は取り消せません。'}</p>
              </div>
            ) : null}
          </div>

          {/* 店の一斉配信と同じ右の列（全部の段でいつも出す。白い板が 1100px 未満のときだけ畳み、頭のボタンで開く）。 */}
          <aside id="hq-broadcast-line-preview" className={formStyles.preview} data-open={previewOpen || undefined} aria-label="LINEの見え方">
            <div className={formStyles.previewHead}>
              <h3>LINE の見え方</h3>
              <div className={formStyles.deviceSwitch} role="group" aria-label="プレビューの端末">
                <Button variant="secondary" className={formStyles.textButton} size="compact" aria-pressed={previewDevice === 'phone'} onClick={() => setPreviewDevice('phone')}>スマホ</Button>
                <Button variant="secondary" className={formStyles.textButton} size="compact" aria-pressed={previewDevice === 'pc'} onClick={() => setPreviewDevice('pc')}>PC</Button>
              </div>
              <Button className={formStyles.previewClose} size="compact" onClick={() => setPreviewOpen(false)}>閉じる</Button>
            </div>
            <div className={previewDevice === 'pc' ? formStyles.pcPreview : formStyles.phonePreview}>
              <LinePreview accountName={exampleStore} caption={when === 'now' ? '今日' : sendWhenLabel} note={`${exampleStore}の例です。差し込みはアカウントごとに変わります（{予約ページ}は省いて見せています）。`}
                empty={previewBubbles.every((item) => !item) ? 'メッセージは「メッセージを作成」で作ります' : false}>
                <div className="flex flex-col gap-3 text-ink">
                  {previewBubbles.map((item, index) => (item ? <BubblePreview key={bubbles[index].id} bubble={item} accountName={exampleStore} /> : null))}
                </div>
              </LinePreview>
            </div>
            <p className={formStyles.previewCaption}>{'{店名} は例のアカウントの名前で見せています'}</p>
            <div className={formStyles.previewSummary}><h3>設定内容</h3><dl>{[
              ['送るアカウント', chosen.length ? `${accountsLabel}（${formatNumber(chosen.length)}）` : '未選択'],
              ['送る相手', `${audienceFull}（${peopleLabel}）`],
              ['送る日時', sendWhenLabel],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></div>
            <div className={formStyles.previewActions}>
              <Button type="button" disabled={checking || chosen.length === 0} title={chosen.length === 0 ? '先に送るアカウントを選んでください' : undefined} onClick={() => setTestOpen(true)}><Send size={14} aria-hidden /> テストを送る</Button>
              <Button type="button" onClick={() => setPreviewConfirmed(true)}><Eye size={14} aria-hidden /> 配信イメージを見る</Button>
            </div>
            <Checkbox checked={previewConfirmed} onCheckedChange={setPreviewConfirmed}>{previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}</Checkbox>
          </aside>
        </div>

        <StickyBar className={formStyles.footer} actions={(
          <>
            {step === 'confirm' ? <Button type="button" onClick={() => changeStep('schedule')}>戻って修正</Button> : null}
            <Button variant="secondary" className={formStyles.textButton} type="button" disabled={checking || sending} busy={checking && step !== 'confirm'} onClick={() => void saveDraft()}>下書きを保存する</Button>
            {step !== 'confirm' ? (
              <Button variant="primary" onClick={() => changeStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)])}>
                {step === 'message' ? <><span>{nextLabel}</span><ArrowRight size={15} aria-hidden /></> : nextLabel}
              </Button>
            ) : (
              <Button variant="primary" busy={checking || sending} disabled={sending || gate === 'pending'} onClick={() => void askSend()}>
                {gate === 'needsRequest' ? '承認を依頼する' : gate === 'pending' ? '承認を待っています' : when === 'later' ? 'この内容で予約する' : '今すぐ送る'}
              </Button>
            )}
          </>
        )} />
      </div>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="一括配信の下書き"
        busy={checking || sending}
        onCancel={() => { if (!checking && !sending) cancelLeave() }}
        onConfirm={() => { confirmLeave() }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={`${formatNumber(totals?.sendStores ?? 0)}アカウントに送ります`}
        description={`${formatNumber(totals?.sendPeople ?? 0)}人に${when === 'now' ? 'すぐ' : `${sendWhenLabel} に`}送ります。送った LINE は取り消せません。${totals && totals.skipStores ? `外した${formatNumber(totals.skipStores)}アカウントには送りません。` : ''}`}
        confirmLabel={when === 'now' ? '送る' : '予約する'}
        busy={sending}
        warning
        onConfirm={gate !== 'single' || (approval.state && Number(confirmCount) === approval.state.gate.recipientCount) ? () => void send() : undefined}
        onCancel={() => setConfirmOpen(false)}
      >
        {gate === 'single' && approval.state ? <SingleOperatorFields recipientCount={approval.state.gate.recipientCount} value={confirmCount} onChange={setConfirmCount} /> : null}
      </ConfirmDialog>

      <HqTestSendDialog open={testOpen} accounts={chosen.filter((s) => !excluded.includes(s.id)).map((s) => ({ id: s.id, name: s.name }))} prepare={prepareForTest} onClose={() => setTestOpen(false)} />

      {/* 詳細条件（店の一斉配信と同じ部品。タグ・シナリオは名前で選び、各アカウントの同じ名前に直す） */}
      <HqTemplatePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pickTemplate} />
      <Dialog
        open={saveTplOpen}
        title="テンプレートとして保存する"
        description="開いているメッセージを、統括のテンプレートに保存します。保存したテンプレートはアカウントへ配ることもできます。"
        confirmLabel="保存する"
        cancelLabel="やめる"
        busy={saveTplBusy}
        error={saveTplError || undefined}
        onConfirm={() => void saveAsTemplate()}
        onCancel={() => setSaveTplOpen(false)}
      >
        <label className={formStyles.nameField}>
          <span className={formStyles.labelRow}>テンプレートの名前<RequiredBadge /></span>
          <input value={saveTplName} onChange={(event) => setSaveTplName(event.target.value)} className={formStyles.textInput} aria-label="テンプレートの名前" maxLength={100} />
        </label>
      </Dialog>
      <Dialog
        open={conditionOpen}
        title="詳細条件で絞り込む"
        description="条件に当てはまる友だちに送ります。タグ・シナリオは、送るアカウントごとに同じ名前のものを使います。"
        confirmLabel="この条件にする"
        cancelLabel="やめる"
        onCancel={() => { setConditionOpen(false); if (!pruneCondition(condition) && !savedName) setAudience('all') }}
        onConfirm={() => { setCondition(conditionDraft); setConditionOpen(false); setAudience('advanced') }}
      >
        <ConditionBuilder
          value={conditionDraft}
          onChange={setConditionDraft}
          showCount={false}
          options={{ tags: (tagOptions ?? []).map((t) => ({ id: t.name, name: t.name })), scenarios: (scenarioOptions ?? []).map((t) => ({ id: t.name, name: t.name })), kinds: HQ_RULE_KINDS }}
        />
      </Dialog>
    </>
  )
}
