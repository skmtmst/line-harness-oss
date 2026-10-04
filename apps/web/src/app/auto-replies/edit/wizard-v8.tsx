'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  GripVertical,
  Play,
  Power,
  X,
} from 'lucide-react'
import type {
  AutoReplyConflict,
  AutoReplyDraftInput,
  AutoReplyDryRunResult,
  AutoReplyValidationResult,
} from '@line-crm/shared'
import { validateFlexContent } from '@line-crm/shared'
import { ApiError, api, describeSaveFailure, type FriendListItem } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { findConditionDraftIssue, type SegmentCondition } from '@/lib/segment-condition'
import Stepper, { type StepperStep } from '@/components/shared/stepper'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { describeAutoReplyDiff } from './auto-reply-conflict-diff'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import TargetMissing from '@/components/shared/target-missing'
import ListState from '@/components/shared/list-state'
import { notifyToast } from '@/components/shared/toast'
import ConditionBuilder from '@/components/shared/condition-builder'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ImageUploader from '@/components/shared/image-uploader'
import { TimeField } from '@/components/shared/date-time-field'
import { loadFailureCopy } from '@/components/shared/api-error-message'
import { formatNumber } from '@/lib/format'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import {
  applyMatchType,
  emptyKeywordRule,
  exactAllMismatchNotice,
  initialMatchType,
  readInlineActions,
  readKeywordRules,
  toActionPayload,
  toKeywordPayload,
  HOLIDAY_RULE_LABELS,
  WEEKDAY_LABELS,
  type HolidayRuleValue,
  type InlineAction,
  type KeywordRuleDraft,
} from '@/components/auto-replies/draft-fields'
import {
  MESSAGE_KIND_WORDS,
  matchTypeWord,
  responseTypeWord,
} from '@/app/auto-replies/auto-reply-words'
import { inEvaluationOrder, PRIORITY_MAX, PRIORITY_MIN, type OrderedRule } from '@/app/auto-replies/auto-reply-order'
import { canPublish, conflictTone, publishGates } from '@/app/auto-replies/publish/publish-flow'
import styles from './wizard-v8.module.css'

/*
 * ★V8 自動応答の作成・編集・有効化。
 *
 * Pencil の正本：①基本設定 `K7HWG` ②どんなときに動くか `A0pDt`
 * ③何を返すか `rfhIf` ④優先順位 `Guoye` ⑤確認 `XJUqs`、完了 `V4LjH`。
 *
 * 一覧（uE9gf）から「作る」で入ると下書きとして作り、最後の「確認」で
 * 有効にする。公開の確かめ（重なり・試し送り・公開前チェック）は
 * 手順4・5の中に畳み込み、別画面の公開フローには分けない。
 * URL の `?step=` が手順の正本。戻る・進むは step の移動として扱い、
 * 未保存の離脱番兵が止めないよう samePage で画面内とみなす。
 */
type WizardStep = 'basic' | 'trigger' | 'response' | 'priority' | 'confirm'
const STEP_ORDER: WizardStep[] = ['basic', 'trigger', 'response', 'priority', 'confirm']
const STEP_LABELS_V8: Record<WizardStep, string> = {
  basic: '基本設定',
  trigger: 'どんなときに動くか',
  response: '何を返すか',
  priority: '優先順位',
  confirm: '確認',
}
const STEP_DESIGN_NODES: Record<WizardStep, string> = {
  basic: 'K7HWG',
  trigger: 'A0pDt',
  response: 'rfhIf',
  priority: 'Guoye',
  confirm: 'XJUqs',
}
const DONE_DESIGN_NODE = 'V4LjH'

type LoadState = 'loading' | 'ready' | 'error' | 'not-found' | 'published-only'
type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(d: {
  responseType: string
  templateId: string | null
}): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

/** LINE送信画像の中身。{originalContentUrl, previewImageUrl} の JSON。 */
function readLineImageContent(content: string): { originalContentUrl: string; previewImageUrl: string } | null {
  try {
    const parsed = JSON.parse(content) as {
      originalContentUrl?: unknown
      previewImageUrl?: unknown
    }
    if (typeof parsed.originalContentUrl === 'string' && parsed.originalContentUrl) {
      return {
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl:
          typeof parsed.previewImageUrl === 'string' && parsed.previewImageUrl
            ? parsed.previewImageUrl
            : parsed.originalContentUrl,
      }
    }
  } catch {
    /* JSON でなければ画像の中身ではない */
  }
  return null
}

/**
 * 画面で持つ下書き。全部を1つのオブジェクトに入れて、保存済みとの差分を
 * シリアライズ比較（dirty）できるようにする。
 */
export interface WizardForm {
  ruleName: string
  folderId: string
  internalMemo: string
  respondToAll: boolean
  keywordRules: KeywordRuleDraft[]
  keywordMatchMode: 'any' | 'all'
  /** 全体に効かせる一致のしかた（行にも載せる）。 */
  matchType: 'exact' | 'contains'
  messageKinds: string[]
  weekdays: number[]
  holidayRule: HolidayRuleValue
  /** 'always' は時間帯なし。'custom' のとき activeFrom/activeUntil を使う。 */
  timeMode: 'always' | 'custom'
  activeFrom: string
  activeUntil: string
  friendTarget: 'all' | 'filtered'
  friendConditions: SegmentCondition | null
  mode: ResponseMode
  templateId: string | null
  responseContent: string
  actions: InlineAction[]
  replyDelaySeconds: string
  cooldownOn: boolean
  cooldownMinutes: string
  skipWhenOperatorActive: boolean
  oncePerFriend: boolean
  unmatchedMode: 'none' | 'notify_operator'
  receiveSources: Array<'line' | 'email'>
  /** 評価順。手順4の「上へ」だけが変える。 */
  priority: number
}

const EMPTY_FORM: WizardForm = {
  ruleName: '',
  folderId: '',
  internalMemo: '',
  respondToAll: false,
  keywordRules: [emptyKeywordRule()],
  keywordMatchMode: 'any',
  matchType: 'exact',
  messageKinds: [],
  weekdays: [],
  holidayRule: 'ignore',
  timeMode: 'always',
  activeFrom: '',
  activeUntil: '',
  friendTarget: 'all',
  friendConditions: null,
  mode: 'inline-text',
  templateId: null,
  responseContent: '',
  actions: [],
  replyDelaySeconds: '0',
  cooldownOn: false,
  cooldownMinutes: '60',
  skipWhenOperatorActive: false,
  oncePerFriend: false,
  unmatchedMode: 'none',
  receiveSources: ['line'],
  priority: 0,
}

/** 保存済みの下書き・公開版の設定を画面の形へ。 */
function formFromSettings(s: AutoReplyDraftInput): WizardForm {
  const rules = readKeywordRules({
    keyword: s.keyword,
    matchType: s.matchType,
    keywords: s.keywords,
  })
  return {
    ruleName: s.name ?? '',
    folderId: s.folderId ?? '',
    internalMemo: s.internalMemo ?? '',
    respondToAll: s.respondToAll,
    keywordRules: rules,
    keywordMatchMode: s.keywordMatchMode ?? 'any',
    matchType: initialMatchType({ keyword: s.keyword, matchType: s.matchType, keywords: s.keywords }),
    messageKinds: s.messageKinds ?? [],
    weekdays: s.responseWeekdays ?? [],
    holidayRule: (s.responseHolidayRule as HolidayRuleValue) ?? 'ignore',
    timeMode: s.activeFrom || s.activeUntil ? 'custom' : 'always',
    activeFrom: s.activeFrom ?? '',
    activeUntil: s.activeUntil ?? '',
    friendTarget: s.friendConditions ? 'filtered' : 'all',
    friendConditions: (s.friendConditions as SegmentCondition | null) ?? null,
    mode: detectMode({ responseType: s.responseType, templateId: s.templateId }),
    templateId: s.templateId,
    responseContent: s.responseContent ?? '',
    actions: readInlineActions(s.actions),
    replyDelaySeconds: s.replyDelaySeconds == null ? '0' : String(s.replyDelaySeconds),
    cooldownOn: s.cooldownMinutes != null && s.cooldownMinutes > 0,
    cooldownMinutes: s.cooldownMinutes == null ? '60' : String(s.cooldownMinutes),
    skipWhenOperatorActive: s.skipWhenOperatorActive ?? false,
    oncePerFriend: s.oncePerFriend ?? false,
    unmatchedMode: s.unmatchedAction?.type === 'notify_operator' ? 'notify_operator' : 'none',
    receiveSources: s.receiveSources?.length ? s.receiveSources : ['line'],
    priority: s.priority ?? 0,
  }
}

/**
 * 手順1「ひな形から作る」。選ぶと名前と条件の下書きまで入る。
 * `lines` は札に並べる中身の説明で、`apply` が実際に入れる内容と一致させる
 * （入れない後の処理は書かない）。
 */
const STARTER_TEMPLATES: Array<{
  key: string
  name: string
  lines: string[]
  apply: (form: WizardForm) => WizardForm
}> = [
  {
    key: 'off-hours',
    name: '営業時間外の自動返信',
    lines: ['毎日21:00〜09:00に受信', 'テキストで返す'],
    apply: (form) => ({
      ...form,
      ruleName: '営業時間外の自動返信',
      respondToAll: true,
      timeMode: 'custom',
      activeFrom: '21:00',
      activeUntil: '09:00',
      mode: 'inline-text',
      responseContent: form.responseContent || '営業時間外のため、翌営業日に担当者からご連絡します。',
    }),
  },
  {
    key: 'booking-change',
    name: '予約変更の受付',
    lines: ['「予約変更」「日程変更」を含む', 'テンプレートで返す'],
    apply: (form) => ({
      ...form,
      ruleName: '予約変更の受付',
      keywordRules: [
        { keyword: '予約変更', matchType: 'contains', minLength: '', caseSensitive: true },
        { keyword: '日程変更', matchType: 'contains', minLength: '', caseSensitive: true },
      ],
      matchType: 'contains',
      keywordMatchMode: 'any',
      mode: 'template',
    }),
  },
  {
    key: 'faq',
    name: 'よくある質問への回答',
    lines: ['「営業時間」「場所」「料金」を含む', 'テンプレートで返す'],
    apply: (form) => ({
      ...form,
      ruleName: 'よくある質問への回答',
      keywordRules: [
        { keyword: '営業時間', matchType: 'contains', minLength: '', caseSensitive: true },
        { keyword: '場所', matchType: 'contains', minLength: '', caseSensitive: true },
        { keyword: '料金', matchType: 'contains', minLength: '', caseSensitive: true },
      ],
      matchType: 'contains',
      keywordMatchMode: 'any',
      mode: 'template',
    }),
  },
]

/**
 * 曜日のまとめ（`A0pDt`：つながりは「月〜金に反応」、ばらばらは「月・水・金に反応」）。
 * 日曜はじまりの番号のまま見る。土日（[0, 6]）はつながりにせず並べる。
 */
function weekdaySummary(days: number[]): string {
  const sorted = days.slice().sort((a, b) => a - b)
  if (sorted.length === 0 || sorted.length === 7) return '毎日反応する'
  const consecutive = sorted.length > 1
    && sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1)
  if (consecutive) {
    return `${WEEKDAY_LABELS[sorted[0]]}〜${WEEKDAY_LABELS[sorted[sorted.length - 1]]}に反応`
  }
  return `${sorted.map((day) => WEEKDAY_LABELS[day]).join('・')}に反応`
}

/** 差し込みに使える札。本文の末尾へトークンを足す。 */
const INSERT_CHIPS = [
  { label: '名前', token: '{name}' },
  { label: '友だち情報', token: '{field}' },
  { label: '共通情報', token: '{var}' },
  { label: '予約日時', token: '{booking_at}' },
] as const

/** 「返すまで待つ時間」の選択肢。 */
const REPLY_DELAY_OPTIONS = [
  { value: '0', label: 'すぐ返す' },
  { value: '10', label: '10秒待つ' },
  { value: '30', label: '30秒待つ' },
  { value: '60', label: '1分待つ' },
  { value: '300', label: '5分待つ' },
]

const WEEKDAY_PRESETS: Array<{ key: string; label: string; days: number[] }> = [
  { key: 'weekday', label: '平日', days: [1, 2, 3, 4, 5] },
  { key: 'weekend', label: '土日', days: [0, 6] },
  { key: 'everyday', label: '毎日', days: [0, 1, 2, 3, 4, 5, 6] },
]

interface RuleRow {
  id: string
  name: string
  isActive: boolean
  lifecycleStatus: string
  priority: number
  createdAt: string
  keyword: string
  activeFrom: string | null
  activeUntil: string | null
}

function displayName(rule: { name?: string | null; keyword?: string }): string {
  return rule.name?.trim() || rule.keyword?.trim() || '名前なしの自動応答'
}

/** テストで「先に動く別ルール」が返した理由コードの読み方。 */
const REASON_WORDS: Record<string, string> = {
  message_kind_not_matched: 'メッセージの種類が違います',
  keyword_not_matched: '言葉に当たりません',
  outside_active_window: '受け付ける時間帯の外です',
  weekday_not_allowed: 'この曜日は受け付けません',
  operator_handling: '担当者が対応中です',
  already_replied_once: 'この友だちへは一度返しています',
  cooldown_active: '前回の返信から間を空けています',
  friend_conditions_not_met: '友だちの条件に当てはまりません',
  higher_priority_won: '上のルールが先に動きます',
}

function readStep(raw: string | null): WizardStep {
  return raw === 'trigger' || raw === 'response' || raw === 'priority' || raw === 'confirm' ? raw : 'basic'
}

function AutoReplyWizardV8Inner() {
  const router = useRouter()
  const params = useSearchParams()
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const { selectedAccountId, accounts } = useAccount()

  const initialId = params.get('id')
  const [autoReplyId, setAutoReplyId] = useState<string | null>(initialId)
  const step = readStep(params.get('step'))
  const [published, setPublished] = useState<{ name: string } | null>(null)
  const stage: WizardStep | 'done' = published ? 'done' : step
  usePageTitle(
    stage === 'done'
      ? '自動応答・有効化完了'
      : `自動応答ルールを${autoReplyId ? '編集' : '作成'}・${STEP_LABELS_V8[stage]}`,
  )

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [versionNumber, setVersionNumber] = useState<number | null>(null)
  const [isActive, setIsActive] = useState(false)
  const [lifecycleStatus, setLifecycleStatus] = useState('draft')
  const [matchedLast28Days, setMatchedLast28Days] = useState<number | null>(null)
  const [wasPublished, setWasPublished] = useState(false)
  const [matchedAccountId, setMatchedAccountId] = useState<string | null>(null)

  const [form, setForm] = useState<WizardForm>(EMPTY_FORM)
  /** 最後に読み込み・保存した形。差分が dirty。 */
  const savedSnapshotRef = useRef(JSON.stringify(EMPTY_FORM))
  // 編集の競合（`UGrd2`：409）。入力は捨てず、比べる・読み込むを選んでもらう。
  const [saveConflict, setSaveConflict] = useState(false)
  const [compareTarget, setCompareTarget] = useState<WizardForm | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  // 作る②の1152（`Z2LIUx`）。折り畳みはCSSが担い、ここでは板IDだけを切り替える。
  const narrow = useNarrowViewport()
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; messageType: string; messageContent: string }>>([])
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [rules, setRules] = useState<RuleRow[]>([])
  const [conflicts, setConflicts] = useState<AutoReplyConflict[]>([])
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [friendTotal, setFriendTotal] = useState(0)
  const [friendQuery, setFriendQuery] = useState('')
  const [friendLoadState, setFriendLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [dryRun, setDryRun] = useState<AutoReplyDryRunResult | null>(null)
  const [staleTest, setStaleTest] = useState(false)
  const [validation, setValidation] = useState<AutoReplyValidationResult | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())
  const [priorityState, setPriorityState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [confirmState, setConfirmState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  /** 保存が通った直後の「✓保存しました」（共通 Button の done、1.2秒）。 */
  const [saveDone, setSaveDone] = useState(false)
  const [error, setError] = useState('')
  const [weekdayNotice, setWeekdayNotice] = useState('')
  const actionOptions = useActionOptions()
  /** 作成・公開の確認キーは画面ごとに1つ振り、成功するまで変えない。 */
  const createKeyRef = useRef(crypto.randomUUID())
  const publishKeyRef = useRef(crypto.randomUUID())

  const patch = (part: Partial<WizardForm>) => setForm((current) => ({ ...current, ...part }))
  const dirty = JSON.stringify(form) !== savedSnapshotRef.current

  useEffect(() => {
    if (dirty) setSaveDone(false)
  }, [dirty])

  const { leaveTarget, confirmLeave, cancelLeave, disarm, guarded } = useUnsavedGuard({
    dirty,
    busy: saving,
    /*
     * step・id（作成後に付く）の違いだけが変わる遷移は画面の中の移動。
     * 戻る・進む・URL書き換えで離脱確認を出さない。
     */
    samePage: (destination) => destination.pathname === '/auto-replies/edit',
    onDiscard: () => {
      setForm(JSON.parse(savedSnapshotRef.current) as WizardForm)
    },
  })

  /* ===== 読み込み ===== */
  const load = useCallback(async () => {
    setLoadState('loading')
    setLoadError(null)
    try {
      const [draftRes, liveRes, folderRes] = await Promise.all([
        autoReplyId ? api.autoReplies.getDraft(autoReplyId) : Promise.resolve(null),
        autoReplyId ? api.autoReplies.get(autoReplyId).catch(() => null) : Promise.resolve(null),
        api.folders.list('auto_reply').catch(() => null),
      ])
      if (folderRes?.success && Array.isArray(folderRes.data)) {
        setFolders(folderRes.data.map((f) => ({ id: f.id, name: f.name })))
      }
      let accountId: string | null = null
      if (autoReplyId) {
        if (!draftRes?.success || !draftRes.data?.settings) {
          setLoadState(draftRes && !draftRes.success ? 'not-found' : 'error')
          return
        }
        const version = draftRes.data
        accountId = version.settings.lineAccountId || null
        const nextForm = formFromSettings(version.settings)
        setForm(nextForm)
        savedSnapshotRef.current = JSON.stringify(nextForm)
        setVersionNumber(version.versionNumber)
        setWasPublished(version.status === 'published')
        setMatchedLast28Days(version.matchedLast28Days ?? null)
        setIsActive(liveRes?.success ? liveRes.data.isActive : false)
        setLifecycleStatus(
          liveRes?.success ? String(liveRes.data.lifecycleStatus ?? 'published') : 'published',
        )
        // 公開済みで下書きの無いものはそのまま編集に入る。保存で新しい下書きが作られる。
      } else {
        accountId = selectedAccountId ?? accounts[0]?.id ?? null
        savedSnapshotRef.current = JSON.stringify(EMPTY_FORM)
        setForm(EMPTY_FORM)
      }
      setMatchedAccountId(accountId)
      // 返す文の候補は、この応答のアカウントだけ。
      const tplRes = await api.templates.list(undefined, accountId ?? undefined).catch(() => null)
      if (tplRes?.success) {
        setTemplates(
          tplRes.data.map((t) => ({
            id: t.id,
            name: t.name,
            messageType: t.messageType,
            messageContent: t.messageContent,
          })),
        )
      }
      setLoadState('ready')
    } catch (caught) {
      setLoadError(caught)
      setLoadState(caught instanceof ApiError && caught.status === 404 ? 'not-found' : 'error')
    }
  }, [autoReplyId, selectedAccountId, accounts])

  useEffect(() => {
    void load()
  }, [load])

  const stepDataRequested = useRef<Set<string>>(new Set())

  /* ===== 手順4・5で読むもの（ルールの並び・重なり・試す相手） ===== */
  /** 評価順の表示に要る「全ルール」と「この下書きと重なるルール」を読む。 */
  const loadOrder = useCallback(async (ruleId: string, accountId: string | null) => {
    const [listRes, conflictRes] = await Promise.all([
      api.autoReplies.list(accountId ? { accountId } : undefined),
      api.autoReplies.conflicts(ruleId).catch(() => null),
    ])
    if (!listRes.success || !Array.isArray(listRes.data)) throw new Error('list failed')
    setRules(
      listRes.data.map((r) => ({
        id: r.id,
        name: r.name ?? '',
        isActive: r.isActive,
        lifecycleStatus: r.lifecycleStatus,
        priority: r.priority,
        createdAt: r.createdAt,
        keyword: r.keyword,
        activeFrom: r.activeFrom ?? null,
        activeUntil: r.activeUntil ?? null,
      })),
    )
    if (conflictRes?.success) {
      setConflicts(Array.isArray(conflictRes.data?.conflicts) ? conflictRes.data.conflicts : [])
    }
  }, [])

  const loadFriendsInitial = useCallback(async (accountId: string | null) => {
    setFriendLoadState('loading')
    try {
      const res = await api.friends.list({
        accountId: accountId ?? undefined,
        includeChatStatus: true,
        limit: 20,
      })
      if (!res.success || !Array.isArray(res.data?.items)) throw new Error('friend list failed')
      setFriends(res.data.items)
      setFriendTotal(typeof res.data.total === 'number' ? res.data.total : res.data.items.length)
      setSelectedFriendId((current) => current || res.data.items[0]?.id || '')
      setFriendLoadState('ready')
    } catch {
      setFriends([])
      setFriendTotal(0)
      setFriendLoadState('error')
    }
  }, [])

  const loadPriorityData = useCallback(
    async (ruleId: string, accountId: string | null) => {
      setPriorityState('loading')
      try {
        await loadOrder(ruleId, accountId)
        void loadFriendsInitial(accountId)
        setPriorityState('ready')
      } catch {
        setPriorityState('error')
      }
    },
    [loadOrder, loadFriendsInitial],
  )

  const searchFriends = useCallback(
    async (query: string) => {
      if (!matchedAccountId) return
      setFriendLoadState('loading')
      try {
        const res = await api.friends.list({
          accountId: matchedAccountId,
          includeChatStatus: true,
          limit: 20,
          search: query.trim() || undefined,
        })
        if (!res.success || !Array.isArray(res.data?.items)) throw new Error('friend list failed')
        setFriends(res.data.items)
        setFriendTotal(typeof res.data.total === 'number' ? res.data.total : res.data.items.length)
        setFriendLoadState('ready')
      } catch {
        setFriendLoadState('error')
      }
    },
    [matchedAccountId],
  )

  /* ===== 手順5で読むもの（公開前チェック） ===== */
  const loadValidation = useCallback(async (ruleId: string) => {
    setConfirmState('loading')
    try {
      const res = await api.autoReplies.validateDraft(ruleId)
      if (!res.success || !res.data) throw new Error('validate failed')
      setValidation(res.data)
      setConflicts(res.data.conflicts ?? [])
      setConfirmState('ready')
    } catch {
      setConfirmState('error')
    }
  }, [])

  /*
   * 手順4・5を URL で直接開いた・戻るで戻ったときも、確かめる対象を読む。
   * 「次へ」経由の読み込みと同じ口。dirty の編集は保存されるまで
   * サーバーの下書きに無いので、未保存のまま飛んだときは保存してから読む
   * ——goNext と同じ約束を直接遷移にも持たせる。
   */
  useEffect(() => {
    if (loadState !== 'ready' || !autoReplyId) return
    if (step !== 'priority' && step !== 'confirm') return
    if (stepDataRequested.current.has(`${step}:${autoReplyId}`)) return
    stepDataRequested.current.add(`${step}:${autoReplyId}`)
    const accountId = matchedAccountId ?? selectedAccountId ?? null
    if (step === 'priority') {
      void loadPriorityData(autoReplyId, accountId)
    } else {
      void loadValidation(autoReplyId)
      void loadOrder(autoReplyId, accountId).catch(() => setPriorityState('error'))
    }
  }, [loadState, autoReplyId, step, matchedAccountId, selectedAccountId, loadPriorityData, loadValidation, loadOrder])

  /* ===== 保存 ===== */
  const buildInput = useCallback((): AutoReplyDraftInput | { error: string } => {
    const effectiveRules = form.keywordRules.filter((rule) => rule.keyword.trim() !== '')
    const firstKeyword = effectiveRules[0]?.keyword.trim() ?? ''
    if (!form.respondToAll && !firstKeyword) {
      return { error: '反応する言葉を入れてください' }
    }
    if (form.cooldownOn) {
      const cooldownValue = Number(form.cooldownMinutes)
      if (!Number.isInteger(cooldownValue) || cooldownValue <= 0 || cooldownValue > 10080) {
        return { error: '「同じ人へ続けて返さない」の時間は1〜10080の整数（分）で入れてください' }
      }
    }
    if (form.mode === 'template' && !form.templateId) {
      return { error: '返すテンプレートを選んでください' }
    }
    if (form.mode === 'inline-text' && !form.responseContent.trim()) {
      return { error: '返す内容を入力してください' }
    }
    if (form.mode === 'inline-flex') {
      if (!form.responseContent.trim()) return { error: 'カードの内容を入力してください' }
      const flexError = validateFlexContent('flex', form.responseContent)
      if (flexError) return { error: flexError }
    }
    if (form.mode === 'inline-image' && !readLineImageContent(form.responseContent)) {
      return { error: '返信する画像を選んでください' }
    }
    const conditionIssue = findConditionDraftIssue(
      form.friendTarget === 'filtered' ? form.friendConditions : null,
    )
    if (conditionIssue) return { error: conditionIssue }
    const accountId = matchedAccountId ?? selectedAccountId ?? accounts[0]?.id ?? null
    if (!accountId) {
      return { error: 'LINEアカウントを選んでから作ってください' }
    }
    const mismatchNotice = exactAllMismatchNotice(effectiveRules, form.keywordMatchMode)
    if (mismatchNotice) return { error: mismatchNotice }

    const body: AutoReplyDraftInput = {
      keyword: firstKeyword || form.keywordRules[0]?.keyword.trim() || 'すべてのメッセージ',
      matchType: effectiveRules[0]?.matchType ?? form.matchType,
      responseType:
        form.mode === 'silent'
          ? 'silent'
          : form.mode === 'inline-flex'
            ? 'flex'
            : form.mode === 'inline-image'
              ? 'image'
              : 'text',
      responseContent: form.mode === 'silent' ? '' : form.responseContent,
      templateId: form.mode === 'template' ? form.templateId : null,
      lineAccountId: accountId,
      activeFrom: form.timeMode === 'custom' ? form.activeFrom || null : null,
      activeUntil: form.timeMode === 'custom' ? form.activeUntil || null : null,
      cooldownMinutes: form.cooldownOn ? Number(form.cooldownMinutes) : null,
      skipWhenOperatorActive: form.skipWhenOperatorActive,
      priority: form.priority,
      messageKinds:
        form.messageKinds.length === 0 || form.messageKinds.length === MESSAGE_KIND_WORDS.length
          ? null
          : form.messageKinds,
      receiveSources: form.receiveSources.length > 0 ? form.receiveSources : ['line'],
      friendConditions:
        form.friendTarget === 'filtered'
          ? (form.friendConditions as Record<string, unknown> | null)
          : null,
      actions: form.actions.length > 0 ? form.actions.map(toActionPayload) : null,
      responseWeekdays:
        form.weekdays.length === 0 || form.weekdays.length === 7 ? null : form.weekdays,
      responseHolidayRule: form.holidayRule === 'ignore' ? null : form.holidayRule,
      oncePerFriend: form.oncePerFriend,
      keywords:
        effectiveRules.length > 0
          ? (effectiveRules.map(toKeywordPayload) as AutoReplyDraftInput['keywords'])
          : null,
      respondToAll: form.respondToAll,
      name: form.ruleName.trim() || null,
      keywordMatchMode: form.keywordMatchMode,
      folderId: form.folderId || null,
      internalMemo: form.internalMemo.trim() || null,
      replyDelaySeconds: Number(form.replyDelaySeconds) > 0 ? Number(form.replyDelaySeconds) : null,
      unmatchedAction: form.unmatchedMode === 'notify_operator' ? { type: 'notify_operator' } : null,
    }
    if (form.mode === 'template' && form.templateId) {
      const tpl = templates.find((t) => t.id === form.templateId)
      if (tpl) {
        body.responseType = tpl.messageType
        body.responseContent = tpl.messageContent
      }
    }
    return body
  }, [form, templates, matchedAccountId, selectedAccountId, accounts])

  /**
   * 下書きをサーバーへ保存する。新規はここで初めてルールを作る。
   * 返り値は保存したルールの id。失敗したら理由を出して null。
   */
  const saveDraftNow = useCallback(async (): Promise<{ id: string; accountId: string | null } | null> => {
    const body = buildInput()
    if ('error' in body) {
      setError(body.error)
      return null
    }
    setSaving(true)
    setError('')
    setSaveNotice('')
    try {
      let savedId = autoReplyId
      if (autoReplyId) {
        if (versionNumber == null) {
          throw new Error('下書きの版情報を確認できません。画面を読み直してください')
        }
        const res = await api.autoReplies.saveDraft(autoReplyId, {
          ...body,
          expectedVersion: versionNumber,
        })
        if (!res.success) throw new Error(res.error || 'save failed')
        setVersionNumber(res.data.versionNumber)
      } else {
        const res = await api.autoReplies.createDraft(body, createKeyRef.current)
        if (!res.success) throw new Error(res.error || 'create failed')
        savedId = res.data.autoReplyId
        setAutoReplyId(res.data.autoReplyId)
        setVersionNumber(res.data.versionNumber)
        setMatchedAccountId(res.data.settings.lineAccountId || null)
        setLifecycleStatus('draft')
        // URL に id を乗せる。戻る・再読込でも下書きに戻れるように。
        const query = new URLSearchParams()
        query.set('id', res.data.autoReplyId)
        query.set('step', step)
        router.replace(`/auto-replies/edit?${query.toString()}`)
      }
      savedSnapshotRef.current = JSON.stringify(form)
      notifyToast('下書きを保存しました')
      // 保存で中身が変わったので、以前の試験・チェックは古いものとして捨てる。
      setSaveConflict(false)
      setDryRun(null)
      setValidation(null)
      setConfirmState('idle')
      stepDataRequested.current.delete(`confirm:${savedId}`)
      stepDataRequested.current.delete(`priority:${savedId}`)
      return { id: savedId!, accountId: body.lineAccountId }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setSaveConflict(true)
        setError('ほかの変更が先に保存されました。比べるか、最新を読み込んでから続けてください。')
      } else {
        setError(describeSaveFailure(caught))
      }
      return null
    } finally {
      setSaving(false)
    }
  }, [buildInput, autoReplyId, versionNumber, form, step, router])

  // `UGrd2`「最新を読み込んで続ける」。入力中の内容は最新の版で置き換わる。
  const reloadAfterConflict = useCallback(async () => {
    setSaveConflict(false)
    setCompareTarget(null)
    setCompareError('')
    setError('')
    await load()
    setSaveNotice('最新の内容を読み込みました')
  }, [load])

  // `UGrd2`「違いを比べる」。最新を取って比べるだけで、画面は書き換えない。
  const openCompare = useCallback(async () => {
    if (!autoReplyId || compareBusy) return
    setCompareBusy(true)
    setCompareError('')
    try {
      const draftRes = await api.autoReplies.getDraft(autoReplyId)
      if (!draftRes?.success || !draftRes.data?.settings) {
        setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
        return
      }
      setCompareTarget(formFromSettings(draftRes.data.settings))
    } catch {
      setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
    } finally {
      setCompareBusy(false)
    }
  }, [autoReplyId, compareBusy])

  /* ===== 手順の移動 ===== */
  const goToStep = useCallback(
    (next: WizardStep, ruleId?: string) => {
      const query = new URLSearchParams()
      // 保存直後は state が追いつく前なので、渡された id を優先する。
      // id が落ちると読み直したときに下書きに戻れない。
      const keepId = ruleId ?? autoReplyId
      if (keepId) query.set('id', keepId)
      query.set('step', next)
      router.replace(`/auto-replies/edit?${query.toString()}`)
    },
    [autoReplyId, router],
  )

  /** 「次へ」。手順4へ入る直前に下書きを保存し、重なりと試す相手を読む。 */
  const goNext = useCallback(async () => {
    setError('')
    const nextIndex = STEP_ORDER.indexOf(step) + 1
    if (nextIndex >= STEP_ORDER.length) return
    const next = STEP_ORDER[nextIndex]
    if (next === 'priority' || next === 'confirm') {
      // 確かめる対象はサーバーの下書き。未保存のままでは確かめられないので、
      // 変更があればここで必ず保存する。
      let ruleId = autoReplyId
      let accountId = matchedAccountId ?? selectedAccountId ?? null
      if (dirty || !autoReplyId) {
        const saved = await saveDraftNow()
        if (!saved) return
        ruleId = saved.id
        accountId = saved.accountId
      }
      if (!ruleId) return
      if (next === 'priority') {
        void loadPriorityData(ruleId, accountId)
      } else {
        void loadValidation(ruleId)
        void loadOrder(ruleId, accountId).catch(() => setPriorityState('error'))
      }
      goToStep(next, ruleId ?? undefined)
    } else {
      goToStep(next)
    }
  }, [step, dirty, autoReplyId, saveDraftNow, matchedAccountId, selectedAccountId, loadPriorityData, loadValidation, loadOrder, goToStep])

  /* ===== 手順4：順番 ===== */
  /**
   * 画面に出す評価順。他のルールはライブの並び、このルールは下書きの
   * priority で差し込む（公開時に draft.priority がライブへ適用される
   * ため、ここで見える順番がそのまま公開後の順番）。
   */
  const orderedRules = useMemo(() => {
    const existing = rules.find((r) => r.id === autoReplyId)
    const mine: RuleRow | null = autoReplyId
      ? {
          id: autoReplyId,
          name: form.ruleName,
          isActive: isActive || lifecycleStatus === 'published',
          lifecycleStatus,
          priority: form.priority,
          createdAt: existing?.createdAt ?? '9999',
          keyword: form.keywordRules[0]?.keyword.trim() ?? '',
          activeFrom: form.timeMode === 'custom' ? form.activeFrom || null : null,
          activeUntil: form.timeMode === 'custom' ? form.activeUntil || null : null,
        }
      : null
    const others = rules.filter((r) => r.id !== autoReplyId)
    return inEvaluationOrder(mine ? [...others, mine] : others)
  }, [rules, autoReplyId, form.priority, form.ruleName, form.keywordRules, form.timeMode, form.activeFrom, form.activeUntil, isActive, lifecycleStatus])

  const myIndex = orderedRules.findIndex((r) => r.id === autoReplyId)
  const myCreatedAt = rules.find((r) => r.id === autoReplyId)?.createdAt ?? ''

  /**
   * このルールを target の直前へ置く priority を返す。
   * 並びは priority 昇順・同値は createdAt 昇順なので、同じ値なら
   * 作った順で負けるときは 1 下げる。画面は常に結果順を再計算して出す。
   */
  const priorityBefore = useCallback(
    (target: OrderedRule): number | null => {
      const winsTie = myCreatedAt !== '' && myCreatedAt < target.createdAt
      if (winsTie) return target.priority
      const lower = target.priority - 1
      if (lower < PRIORITY_MIN) return null
      return lower
    },
    [myCreatedAt],
  )

  const moveUp = useCallback(() => {
    if (myIndex <= 0) return
    const above = orderedRules[myIndex - 1]
    const next = priorityBefore(above)
    if (next == null || next > PRIORITY_MAX) return
    patch({ priority: next })
  }, [myIndex, orderedRules, priorityBefore])

  /** 「『○○』より前へ」：最初に重なっているルールの直前まで一気に上げる。 */
  const firstConflictAbove = useMemo(() => {
    if (myIndex < 0) return null
    const conflictIds = new Set(conflicts.map((c) => c.autoReplyId))
    return orderedRules.slice(0, myIndex).reverse().find((r) => conflictIds.has(r.id)) ?? null
  }, [orderedRules, myIndex, conflicts])

  const moveBeforeFirstConflict = useCallback(() => {
    if (!firstConflictAbove) return
    const next = priorityBefore(firstConflictAbove)
    if (next == null || next > PRIORITY_MAX) return
    patch({ priority: next })
  }, [firstConflictAbove, priorityBefore])

  /* ===== 手順4：試しに送る ===== */
  const runTest = useCallback(async () => {
    if (!autoReplyId || !selectedFriendId || !testMessage.trim()) return
    setSaving(true)
    setError('')
    try {
      // 試す内容はいま画面にあるもの。未保存なら先に保存してから試す。
      let ruleId = autoReplyId
      if (dirty) {
        const saved = await saveDraftNow()
        if (!saved) return
        ruleId = saved.id
      }
      if (!ruleId) return
      const res = await api.autoReplies.testDraft(ruleId, {
        friendId: selectedFriendId,
        incomingText: testMessage.trim(),
      })
      if (!res.success) throw new Error(res.error || 'test failed')
      if (res.data.staleTest) {
        setDryRun(null)
        setStaleTest(true)
        return
      }
      setStaleTest(false)
      setDryRun(res.data)
    } catch {
      setError('試し送りできませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }, [autoReplyId, selectedFriendId, testMessage, dirty, saveDraftNow])

  /* ===== 手順5：有効にする ===== */
  const gates = useMemo(
    () => publishGates(validation, dryRun, acknowledged),
    [validation, dryRun, acknowledged],
  )
  const publishReady = canPublish(gates)

  const publish = useCallback(async () => {
    if (!autoReplyId || !publishReady || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await api.autoReplies.publishDraft(
        autoReplyId,
        { acknowledgedConflictIds: [...acknowledged] },
        publishKeyRef.current,
      )
      if (!res.success) {
        if (res.error?.includes('競合') || res.error?.includes('確認')) {
          setError('重なりの確認が足りていません。手順4へ戻って確かめてください。')
        } else {
          setError(res.error || '自動応答を有効化できませんでした。状態を読み直してからお試しください。')
        }
        void loadValidation(autoReplyId)
        return
      }
      const doneName = form.ruleName.trim() || form.keywordRules[0]?.keyword.trim() || '自動応答'
      setPublished({ name: doneName })
      notifyToast(`「${doneName}」を有効にしました`)
      disarm()
      publishKeyRef.current = crypto.randomUUID()
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? caught.message || '公開する直前に状態が変わりました。最新の状態を読み直してください。'
          : '自動応答を有効化できませんでした。状態を読み直してからお試しください。',
      )
      void loadValidation(autoReplyId)
    } finally {
      setSaving(false)
    }
  }, [autoReplyId, publishReady, saving, acknowledged, form.ruleName, form.keywordRules, disarm, loadValidation])

  /* ===== 手順ごとの内容 ===== */
  const effectiveKeywords = form.keywordRules.filter((r) => r.keyword.trim() !== '')
  const selectedTemplate =
    form.mode === 'template' ? templates.find((t) => t.id === form.templateId) ?? null : null
  const imageContent = form.mode === 'inline-image' ? readLineImageContent(form.responseContent) : null
  const flexContentIsJson = (() => {
    if (form.mode !== 'inline-flex' || !form.responseContent.trim()) return false
    try {
      JSON.parse(form.responseContent)
      return true
    } catch {
      return false
    }
  })()
  const replyPreviewText =
    form.mode === 'silent'
      ? '返信はせず、設定した処理だけを行います。'
      : form.mode === 'template'
        ? selectedTemplate
          ? selectedTemplate.messageContent
          : 'テンプレートを選ぶと、ここに内容が出ます。'
        : form.mode === 'inline-image'
          ? '画像を返します。'
          : form.mode === 'inline-flex'
            ? flexContentIsJson
              ? 'カード型メッセージを返します。'
              : 'カードの内容（JSON）を読めていません。'
            : form.responseContent || '返す内容を入れると、ここに出ます。'

  const thisRuleName = form.ruleName.trim() || effectiveKeywords[0]?.keyword.trim() || '名前なしのルール'
  const myPositionLabel = myIndex >= 0 ? `${myIndex + 1}番目` : 'いちばん下'

  /* ===== 読み込み・権限の画面 ===== */
  if (loadState === 'loading') return <ListState kind="loading" />
  if (loadState === 'not-found') {
    return (
      <TargetMissing
        kind="not-found"
        title="この自動応答は見つかりません"
        description="削除されたか、別の記録です。一覧から選び直してください。"
        backHref="/auto-replies"
        backLabel="自動応答の一覧へ戻る"
      />
    )
  }
  if (loadState === 'error') {
    const failure = loadError ? loadFailureCopy(loadError, '下書き') : null
    return (
      <TargetMissing
        kind="error"
        title={failure?.title ?? '下書きを読み込めませんでした'}
        description={
          failure?.description ??
          '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'
        }
        error={loadError ?? undefined}
        onRetry={() => void load()}
      />
    )
  }
  if (!canManage) {
    return (
      <ListState
        kind="forbidden"
        title="自動応答の作成・変更はできません"
        description="作成と変更はオーナーと管理者だけができます。必要なときはオーナーか管理者に頼んでください。"
        action={<Button href="/auto-replies">自動応答の一覧へ戻る</Button>}
      />
    )
  }

  /* ===== 完了（V4LjH） ===== */
  if (stage === 'done') {
    return (
      <div className={styles.page} data-design-node={DONE_DESIGN_NODE}>
        <Link href="/auto-replies" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden="true" />
          自動応答へ
        </Link>
        <section className={styles.done}>
          <span className={styles.doneIcon} aria-hidden="true">
            <CheckCircle2 size={36} />
          </span>
          <h1 className={styles.doneTitle}>「{published!.name}」を有効にしました</h1>
          <p className={styles.doneNote}>
            届いたメッセージの中に合うものがあれば、いまの設定で自動で返します。
            止めたいときは一覧の「止める」からいつでも止められます。
          </p>
          <dl className={`${styles.kvList} ${styles.doneRows}`}>
            <div className={styles.kvRow}>
              <dt className={styles.kvKey}>動く順番</dt>
              <dd className={styles.kvVal}>{myPositionLabel}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt className={styles.kvKey}>反応する言葉</dt>
              <dd className={styles.kvVal}>
                {form.respondToAll
                  ? 'すべてのメッセージ'
                  : effectiveKeywords.map((r) => `「${r.keyword.trim()}」`).join('') || '—'}
              </dd>
            </div>
          </dl>
          <div className={styles.doneActions}>
            <Button href="/auto-replies">一覧へ戻る</Button>
            <Button href={`/auto-replies/runs?id=${encodeURIComponent(autoReplyId ?? '')}`}>
              実行結果を見る
            </Button>
            <Button
              href="/auto-replies/edit"
              variant="primary"
            >
              もう1つ作る
            </Button>
          </div>
        </section>
      </div>
    )
  }

  const stepperSteps: StepperStep[] = STEP_ORDER.map((key, index) => ({
    key,
    label: STEP_LABELS_V8[key],
    state: index < STEP_ORDER.indexOf(step) ? 'done' : 'todo',
    onSelect:
      index < STEP_ORDER.indexOf(step)
        ? () => goToStep(key)
        : undefined,
  }))

  const statusBadge = lifecycleStatus === 'draft' ? '下書き' : isActive ? '有効' : '停止中'

  return (
    <div className={styles.page} data-design-node={step === 'trigger' && narrow ? 'Z2LIUx' : STEP_DESIGN_NODES[step]}>
      <Link href="/auto-replies" className={styles.backLink}>
        <ArrowLeft size={14} aria-hidden="true" />
        自動応答へ
      </Link>
      <div className={styles.headText}>
        <h1 className={styles.headTitle}>{autoReplyId ? 'ルールを編集' : 'ルールを作る'}</h1>
      </div>

      <Stepper label="自動応答を作る進み方" steps={stepperSteps} currentKey={step} />

      <p className={styles.subline}>
        {step === 'basic' ? (
          'いまは停止中として作ります。最後の「確認」で有効にします。'
        ) : (
          <>
            <span>
              ルール名：<span className={styles.sublineName}>{thisRuleName}</span>
            </span>
            <span className={styles.sublineBadge}>{statusBadge}として編集中</span>
          </>
        )}
      </p>

      {saveConflict && (
        <div className="border-accent bg-accent-soft rounded-card flex flex-wrap items-center gap-3 border p-4" data-design-node="UGrd2" role="alert">
          <p className="text-ink min-w-0 flex-1 text-sm">
            ほかの人が先に保存しました。
            <span className="text-ink-secondary mt-0.5 block text-xs">
              あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void openCompare()} disabled={compareBusy}>
              {compareBusy ? '比べています...' : '違いを比べる'}
            </Button>
            <Button type="button" variant="primary" onClick={() => void reloadAfterConflict()}>
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      )}
      {error ? <Notice tone="danger" message={error} onClose={() => setError('')} /> : null}
      {saveNotice ? <Notice tone="success" message={saveNotice} onClose={() => setSaveNotice('')} /> : null}
      {staleTest ? (
        <Notice
          tone="warn"
          message="試したあとに内容が変わっています。もう一度「試す」で確かめてください。"
          onClose={() => setStaleTest(false)}
        />
      ) : null}

      <div className={styles.cols}>
        <div className={styles.main}>
          {step === 'basic' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>名前とフォルダ</h2>
                <p className={styles.cardNote}>一覧に出る名前です。友だちには見えません。</p>
                <div className={styles.fieldPair}>
                  <div className={styles.field}>
                    <label htmlFor="wiz-name" className={styles.label}>
                      ルール名
                    </label>
                    <input
                      id="wiz-name"
                      className={styles.input}
                      value={form.ruleName}
                      onChange={(e) => patch({ ruleName: e.target.value })}
                      placeholder="例：予約の日程変更"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="wiz-folder" className={styles.label}>
                      フォルダ
                    </label>
                    <Select
                      id="wiz-folder"
                      aria-label="フォルダ"
                      value={form.folderId}
                      onChange={(value) => patch({ folderId: value })}
                      options={[
                        { value: '', label: '分けない' },
                        ...folders.map((f) => ({ value: f.id, label: f.name })),
                      ]}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="wiz-memo" className={styles.label}>
                    社内メモ <span className={styles.labelOptional}>（任意）</span>
                  </label>
                  <input
                    id="wiz-memo"
                    className={styles.input}
                    value={form.internalMemo}
                    onChange={(e) => patch({ internalMemo: e.target.value })}
                    placeholder="例：キャンペーン中だけ使う"
                  />
                </div>
              </section>

              <Notice tone="info">
                新しく作るルールは、一覧のいちばん下（最後に見る順番）に足されます。順番は手順4「優先順位」で確かめます。
              </Notice>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>ひな形から作る（任意）</h2>
                <p className={styles.cardNote}>選ぶと、条件と返信がまとめて入ります。あとから全部変えられます。</p>
                <div className={styles.tplGrid}>
                  {STARTER_TEMPLATES.map((tpl) => (
                    <div key={tpl.key} className={styles.tplCard}>
                      <p className={styles.tplName}>{tpl.name}</p>
                      {tpl.lines.map((line) => (
                        <p key={line} className={styles.tplDesc}>{line}</p>
                      ))}
                      <Button
                        type="button"
                        onClick={() => {
                          setForm((current) => tpl.apply(current))
                          goToStep('trigger')
                        }}
                      >
                        このひな形を使う
                      </Button>
                    </div>
                  ))}
                </div>
                <div className={styles.tplFoot}>
                  <Button href="/templates">ひな形を管理</Button>
                </div>
              </section>
            </>
          )}

          {step === 'trigger' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>1. どのメッセージに反応するか</h2>
                <RadioCardGroup legend="反応するメッセージ" className={styles.radioPair}>
                  <RadioCard
                    name="trigger-kind"
                    value="keyword"
                    checked={!form.respondToAll}
                    onChange={() => patch({ respondToAll: false })}
                    title="言葉で反応する"
                    note="決めた言葉が入っていたら返す"
                  />
                  <RadioCard
                    name="trigger-kind"
                    value="all"
                    checked={form.respondToAll}
                    onChange={() => patch({ respondToAll: true })}
                    title="すべてのメッセージ"
                    note="届いたものすべてに返す"
                  />
                </RadioCardGroup>

                {!form.respondToAll && (
                  <>
                    <div className={styles.field}>
                      <span className={styles.label} id="wiz-keywords-label">反応する言葉</span>
                      <div className={styles.chips} role="group" aria-labelledby="wiz-keywords-label">
                        {effectiveKeywords.map((rule, index) => (
                          <span key={`${rule.keyword}-${index}`} className={styles.chip}>
                            {rule.keyword.trim()}
                            <button
                              type="button"
                              className={styles.chipRemove}
                              aria-label={`「${rule.keyword.trim()}」を外す`}
                              onClick={() =>
                                patch({
                                  keywordRules: effectiveKeywords.filter((_, i) => i !== index),
                                })
                              }
                            >
                              <X size={13} aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                        <KeywordInput
                          onAdd={(word) => {
                            const trimmed = word.trim()
                            if (!trimmed) return
                            if (form.keywordRules.some((r) => r.keyword.trim() === trimmed)) return
                            patch({
                              keywordRules: [
                                ...form.keywordRules.filter((r) => r.keyword.trim() !== ''),
                                { keyword: trimmed, matchType: form.matchType, minLength: '', caseSensitive: true },
                              ],
                            })
                          }}
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>言葉の合い方</span>
                      <div className={styles.seg} role="group" aria-label="言葉の合い方">
                        <button
                          type="button"
                          className={styles.segBtn}
                          aria-pressed={form.matchType === 'contains'}
                          onClick={() =>
                            patch({
                              matchType: 'contains',
                              keywordRules: applyMatchType(form.keywordRules, 'contains'),
                            })
                          }
                        >
                          部分一致（含む）
                        </button>
                        <button
                          type="button"
                          className={styles.segBtn}
                          aria-pressed={form.matchType === 'exact'}
                          onClick={() =>
                            patch({
                              matchType: 'exact',
                              keywordRules: applyMatchType(form.keywordRules, 'exact'),
                            })
                          }
                        >
                          完全一致
                        </button>
                      </div>
                    </div>
                    {effectiveKeywords.length > 1 && (
                      <div className={styles.field}>
                        <span className={styles.label}>言葉が2つ以上のとき</span>
                        <div className={styles.seg} role="group" aria-label="言葉が2つ以上のとき">
                          <button
                            type="button"
                            className={styles.segBtn}
                            aria-pressed={form.keywordMatchMode === 'any'}
                            onClick={() => patch({ keywordMatchMode: 'any' })}
                          >
                            どれか1つで反応
                          </button>
                          <button
                            type="button"
                            className={styles.segBtn}
                            aria-pressed={form.keywordMatchMode === 'all'}
                            onClick={() => patch({ keywordMatchMode: 'all' })}
                          >
                            すべて入っていたら
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className={styles.field}>
                  <span className={styles.label}>反応するメッセージの種類</span>
                  <div className={styles.chips} role="group" aria-label="反応するメッセージの種類">
                    {MESSAGE_KIND_WORDS.map((kind) => {
                      const on = form.messageKinds.includes(kind.key)
                      return (
                        <button
                          key={kind.key}
                          type="button"
                          className={styles.pickChip}
                          aria-pressed={on}
                          onClick={() =>
                            patch({
                              messageKinds: on
                                ? form.messageKinds.filter((k) => k !== kind.key)
                                : [...form.messageKinds, kind.key],
                            })
                          }
                        >
                          {kind.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className={styles.hint}>
                    {form.messageKinds.length === 0
                      ? '何も選ばなければ、どの種類のメッセージにも反応します。'
                      : '言葉で反応するときは、テキストだけに絞るのがおすすめです。'}
                  </p>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>受け取る場所</span>
                  <div className={styles.chips} role="group" aria-label="受け取る場所">
                    <Checkbox
                      checked={form.receiveSources.includes('line')}
                      onCheckedChange={(on) =>
                        patch({
                          receiveSources: on
                            ? [...new Set([...form.receiveSources, 'line' as const])]
                            : form.receiveSources.filter((s) => s !== 'line'),
                        })
                      }
                    >
                      LINE
                    </Checkbox>
                    <Checkbox
                      checked={form.receiveSources.includes('email')}
                      onCheckedChange={(on) =>
                        patch({
                          receiveSources: on
                            ? [...new Set([...form.receiveSources, 'email' as const])]
                            : form.receiveSources.filter((s) => s !== 'email'),
                        })
                      }
                    >
                      メール
                    </Checkbox>
                  </div>
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>2. いつ反応するか</h2>
                <div className={styles.field}>
                  <span className={styles.label}>曜日</span>
                  <div className={styles.weekdays} role="group" aria-label="反応する曜日">
                    {WEEKDAY_LABELS.map((label, index) => {
                      const on = form.weekdays.includes(index)
                      return (
                        <button
                          key={label}
                          type="button"
                          className={styles.weekday}
                          aria-pressed={on}
                          onClick={() => {
                            const next = on
                              ? form.weekdays.filter((d) => d !== index)
                              : [...form.weekdays, index].sort()
                            if (next.length === 0) {
                              setWeekdayNotice('全部の曜日を外すと、このルールはどの曜日にも反応しなくなります。')
                            } else {
                              setWeekdayNotice('')
                            }
                            patch({ weekdays: next })
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <div className={styles.weekdayPresets}>
                    <span>まとめて：</span>
                    {WEEKDAY_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        className={styles.weekdayPreset}
                        onClick={() => {
                          setWeekdayNotice('')
                          patch({ weekdays: preset.days })
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <span className={styles.weekdayNow}>
                      {weekdaySummary(form.weekdays)}
                    </span>
                  </div>
                  {weekdayNotice ? <p className={styles.hint}>{weekdayNotice}</p> : null}
                  <p className={styles.hint}>祝日は「営業日」の設定に従います。</p>
                  <RadioCardGroup legend="祝日の扱い" className={styles.radioPair}>
                    {HOLIDAY_RULE_LABELS.map((option) => (
                      <RadioCard
                        key={option.value}
                        name="holiday-rule"
                        value={option.value}
                        checked={form.holidayRule === option.value}
                        onChange={(v) => patch({ holidayRule: v as HolidayRuleValue })}
                        title={option.label}
                        note={option.hint}
                      />
                    ))}
                  </RadioCardGroup>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>時間帯</span>
                  <div className={styles.seg} role="group" aria-label="反応する時間帯">
                    <button
                      type="button"
                      className={styles.segBtn}
                      aria-pressed={form.timeMode === 'always'}
                      onClick={() => patch({ timeMode: 'always' })}
                    >
                      いつでも
                    </button>
                    <button
                      type="button"
                      className={styles.segBtn}
                      aria-pressed={form.timeMode === 'custom' && form.activeFrom === '21:00' && form.activeUntil === '09:00'}
                      onClick={() => patch({ timeMode: 'custom', activeFrom: '21:00', activeUntil: '09:00' })}
                      title="夜21時から朝9時まで。時刻はあとから変えられます"
                    >
                      営業時間外だけ
                    </button>
                    <button
                      type="button"
                      className={styles.segBtn}
                      aria-pressed={form.timeMode === 'custom' && !(form.activeFrom === '21:00' && form.activeUntil === '09:00')}
                      onClick={() => patch({ timeMode: 'custom', activeFrom: form.activeFrom || '09:00', activeUntil: form.activeUntil || '18:00' })}
                    >
                      時刻を決める
                    </button>
                  </div>
                  {form.timeMode === 'custom' && (
                    <div className={styles.chips}>
                      <TimeField
                        aria-label="始める時刻"
                        value={form.activeFrom}
                        onChange={(v) => patch({ activeFrom: v })}
                      />
                      <span className={styles.weekdayNow}>〜</span>
                      <TimeField
                        aria-label="終わる時刻"
                        value={form.activeUntil}
                        onChange={(v) => patch({ activeUntil: v })}
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>3. 誰に反応するか</h2>
                <RadioCardGroup legend="反応する相手" className={styles.radioPair}>
                  <RadioCard
                    name="friend-target"
                    value="all"
                    checked={form.friendTarget === 'all'}
                    onChange={() => patch({ friendTarget: 'all' })}
                    title="すべての友だち"
                    note="届いた人みんなに返す"
                  />
                  <RadioCard
                    name="friend-target"
                    value="filtered"
                    checked={form.friendTarget === 'filtered'}
                    onChange={() => patch({ friendTarget: 'filtered' })}
                    title="条件に合う友だち"
                    note="タグ・友だち情報・予約などで絞る"
                  />
                </RadioCardGroup>
                {form.friendTarget === 'filtered' ? (
                  <ConditionBuilder
                    value={form.friendConditions}
                    onChange={(next) => patch({ friendConditions: next })}
                    label="反応する友だちの条件"
                  />
                ) : (
                  <p className={styles.hint}>条件を入れないと、全員に反応します。</p>
                )}
              </section>
            </>
          )}

          {step === 'response' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>返すもの</h2>
                <div className={styles.chips} role="group" aria-label="返すもの">
                  {(
                    [
                      ['inline-text', 'この画面で書く'],
                      ['template', 'テンプレートから'],
                      ['inline-flex', 'カード'],
                      ['inline-image', '画像'],
                      ['silent', '返信しない（後の処理だけ）'],
                    ] as Array<[ResponseMode, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={styles.pickChip}
                      aria-pressed={form.mode === value}
                      onClick={() => patch({ mode: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {form.mode === 'inline-text' && (
                  <div className={styles.field}>
                    <label htmlFor="wiz-content" className={styles.label}>
                      返す文
                    </label>
                    <textarea
                      id="wiz-content"
                      className={styles.textarea}
                      value={form.responseContent}
                      onChange={(e) => patch({ responseContent: e.target.value })}
                      placeholder="例：予約の変更を承りました。担当者が確認次第ご連絡します。"
                      maxLength={5000}
                    />
                    <div className={styles.insertChips}>
                      {INSERT_CHIPS.map((chip) => (
                        <button
                          key={chip.token}
                          type="button"
                          className={styles.insertChip}
                          title={`${chip.label}を差し込む`}
                          onClick={() => patch({ responseContent: form.responseContent + chip.token })}
                        >
                          {chip.label}
                        </button>
                      ))}
                      <span className={styles.counter}>
                        {formatNumber(form.responseContent.length)} / 5,000
                      </span>
                    </div>
                  </div>
                )}

                {form.mode === 'template' && (
                  <div className={styles.field}>
                    <label htmlFor="wiz-template" className={styles.label}>
                      テンプレート
                    </label>
                    <Select
                      id="wiz-template"
                      aria-label="テンプレート"
                      value={form.templateId ?? ''}
                      onChange={(v) => patch({ templateId: v || null })}
                      options={[
                        { value: '', label: '選んでください' },
                        ...templates.map((t) => ({
                          value: t.id,
                          label: `${t.name}（${responseTypeWord(t.messageType).label}）`,
                        })),
                      ]}
                    />
                    <p className={styles.hint}>テンプレートの管理は「ひな形を管理」からできます。</p>
                  </div>
                )}

                {form.mode === 'inline-flex' && (
                  <div className={styles.field}>
                    <label htmlFor="wiz-flex" className={styles.label}>
                      カードの内容（JSON）
                    </label>
                    <textarea
                      id="wiz-flex"
                      className={styles.textarea}
                      value={form.responseContent}
                      onChange={(e) => patch({ responseContent: e.target.value })}
                      placeholder='{"type":"bubble", ...}'
                    />
                  </div>
                )}

                {form.mode === 'inline-image' && (
                  <ImageUploader
                    mode="line-image"
                    label="返信する画像"
                    value={
                      imageContent
                        ? { mode: 'line-image', ...imageContent }
                        : null
                    }
                    onChange={(v) =>
                      patch({
                        responseContent:
                          v && v.mode === 'line-image'
                            ? JSON.stringify({ originalContentUrl: v.originalContentUrl, previewImageUrl: v.previewImageUrl })
                            : '',
                      })
                    }
                  />
                )}

                {form.mode === 'silent' && (
                  <p className={styles.hint}>
                    返信は送りません。下の「返したあとに行うこと」で決めた処理だけが動きます。
                  </p>
                )}
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>返したあとに行うこと</h2>
                <p className={styles.cardNote}>上から順に動きます。失敗したときの動きも決められます。</p>
                <InlineActionList
                  actions={form.actions}
                  onChange={(next) => patch({ actions: next })}
                  {...actionOptions}
                />
                <p className={styles.hint}>
                  例：タグを付ける・担当者へ知らせる・シナリオを始める。何もなければ空のままで構いません。
                </p>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>細かい決まり</h2>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleText}>
                    <p className={styles.toggleTitle}>返すまで待つ時間</p>
                  </div>
                  <Select
                    aria-label="返すまで待つ時間"
                    value={form.replyDelaySeconds}
                    onChange={(v) => patch({ replyDelaySeconds: v })}
                    options={[...REPLY_DELAY_OPTIONS]}
                  />
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleText}>
                    <p className={styles.toggleTitle}>同じ人へ続けて返さない</p>
                    <p className={styles.toggleNote}>
                      {form.cooldownOn ? `${form.cooldownMinutes}分あけます` : 'オフのときは何度でも返します'}
                    </p>
                  </div>
                  <div className={styles.toggleExtra}>
                    {form.cooldownOn && (
                      <input
                        type="number"
                        className={styles.toggleNum}
                        aria-label="あける時間（分）"
                        min={1}
                        max={10080}
                        value={form.cooldownMinutes}
                        onChange={(e) => patch({ cooldownMinutes: e.target.value })}
                      />
                    )}
                    <Toggle
                      label="同じ人へ続けて返さない"
                      checked={form.cooldownOn}
                      onChange={(on) => patch({ cooldownOn: on })}
                    />
                  </div>
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleText}>
                    <p className={styles.toggleTitle}>担当者が対応中のトークには返さない</p>
                  </div>
                  <Toggle
                    label="担当者が対応中のトークには返さない"
                    checked={form.skipWhenOperatorActive}
                    onChange={(on) => patch({ skipWhenOperatorActive: on })}
                  />
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleText}>
                    <p className={styles.toggleTitle}>1人につき1回だけ返す</p>
                    <p className={styles.toggleNote}>
                      オフのときは、同じ人が何度送っても返します（上の「続けて返さない」の時間は守ります）
                    </p>
                  </div>
                  <Toggle
                    label="1人につき1回だけ返す"
                    checked={form.oncePerFriend}
                    onChange={(on) => patch({ oncePerFriend: on })}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>条件に合わなかったとき</span>
                  <RadioCardGroup legend="条件に合わなかったとき" className={styles.radioPair}>
                    <RadioCard
                      name="unmatched"
                      value="none"
                      checked={form.unmatchedMode === 'none'}
                      onChange={() => patch({ unmatchedMode: 'none' })}
                      title="何もしない"
                      note="反応しないまま終わります"
                    />
                    <RadioCard
                      name="unmatched"
                      value="notify"
                      checked={form.unmatchedMode === 'notify_operator'}
                      onChange={() => patch({ unmatchedMode: 'notify_operator' })}
                      title="担当者へ引き継ぐ"
                      note="人手で対応するよう知らせます"
                    />
                  </RadioCardGroup>
                </div>
              </section>
            </>
          )}

          {step === 'priority' && (
            <>
              <Notice tone="info">
                上のルールから順に見て、最初に当たった1つだけが動きます。このルールより上に、同じ受信に当たるルールがあると、このルールは動きません。
              </Notice>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>動く順番</h2>
                {priorityState === 'error' ? (
                  <p className={styles.hint}>
                    ルールの並びを読み込めませんでした。
                    <button
                      type="button"
                      className={styles.weekdayPreset}
                      onClick={() => autoReplyId && void loadPriorityData(autoReplyId, matchedAccountId)}
                    >
                      読み直す
                    </button>
                  </p>
                ) : (
                  <ol className={styles.orderList}>
                    {orderedRules.map((rule, index) => {
                      const isSelf = rule.id === autoReplyId
                      const isConflict = conflicts.some((c) => c.autoReplyId === rule.id)
                      const aboveSelf = myIndex >= 0 && index < myIndex
                      return (
                        <li
                          key={rule.id}
                          className={[
                            styles.orderRow,
                            isSelf ? styles.orderRowSelf : '',
                            isConflict && aboveSelf ? styles.orderRowConflict : '',
                          ].join(' ')}
                        >
                          <GripVertical size={16} aria-hidden="true" className={styles.orderGrip} />
                          <span className={styles.orderNum}>{index + 1}</span>
                          <div className={styles.orderBody}>
                            <p className={styles.orderName}>
                              {isSelf ? `${displayName(rule)}（このルール）` : displayName(rule)}
                            </p>
                            <p className={styles.orderSub}>
                              {rule.lifecycleStatus === 'draft' || !rule.isActive ? (
                                <span>停止中</span>
                              ) : null}
                              {isConflict && aboveSelf ? (
                                <span className={styles.orderOverlap}>
                                  同じ受信に当たります → このルールより先に動きます
                                </span>
                              ) : isConflict ? (
                                <span className={styles.orderOverlap}>同じ受信に当たることがあります</span>
                              ) : null}
                              {!isConflict && rule.activeFrom ? (
                                <span>
                                  {rule.activeFrom}〜{rule.activeUntil ?? ''}だけ動く
                                </span>
                              ) : null}
                            </p>
                          </div>
                          {isSelf && (
                            <span className={styles.orderMove}>
                              <Button
                                type="button"
                                size="compact"
                                disabled={myIndex <= 0}
                                onClick={moveUp}
                              >
                                上へ
                              </Button>
                              {firstConflictAbove && (
                                <Button
                                  type="button"
                                  size="compact"
                                  variant="primary"
                                  onClick={moveBeforeFirstConflict}
                                >
                                  「{displayName(firstConflictAbove)}」より前へ
                                </Button>
                              )}
                            </span>
                          )}
                        </li>
                      )
                    })}
                    {orderedRules.length === 0 && priorityState !== 'loading' && (
                      <li className={styles.hint}>ほかのルールはまだありません。このルールがいちばん上に動きます。</li>
                    )}
                    {priorityState === 'loading' && <li className={styles.hint}>読み込んでいます…</li>}
                  </ol>
                )}
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>試しに送ってみる</h2>
                <div className={styles.field}>
                  <label htmlFor="wiz-test-friend" className={styles.label}>
                    送信者
                  </label>
                  <div className={styles.chips}>
                    <input
                      type="search"
                      className={styles.chipInput}
                      placeholder="名前で探す"
                      value={friendQuery}
                      onChange={(e) => {
                        setFriendQuery(e.target.value)
                        void searchFriends(e.target.value)
                      }}
                      aria-label="友だちを名前で探す"
                    />
                  </div>
                  <Select
                    id="wiz-test-friend"
                    aria-label="送信者"
                    value={selectedFriendId}
                    onChange={setSelectedFriendId}
                    options={
                      friendLoadState === 'error'
                        ? [{ value: '', label: '友だちを読み込めませんでした' }]
                        : friends.length === 0
                          ? [{ value: '', label: '友だちがいません' }]
                          : friends.map((f) => ({ value: f.id, label: f.displayName || '名前なし' }))
                    }
                  />
                  <p className={styles.hint}>
                    {friendLoadState === 'ready'
                      ? `候補${formatNumber(friendTotal)}人中 ${friends.length}人を表示`
                      : '友だちを読み込んでいます…'}
                  </p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="wiz-test-message" className={styles.label}>
                    届いたメッセージ
                  </label>
                  <input
                    id="wiz-test-message"
                    className={styles.input}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder={effectiveKeywords[0]?.keyword.trim() || '例：予約変更したいです'}
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void runTest()}
                    disabled={!selectedFriendId || !testMessage.trim() || saving}
                    busy={saving}
                    busyLabel="試しています…"
                  >
                    <Play size={14} aria-hidden="true" />
                    試す
                  </Button>
                </div>
                {dryRun && (
                  <div
                    className={`${styles.testResult} ${dryRun.draftWon ? styles.testResultWin : styles.testResultLose}`}
                    role="status"
                  >
                    <p className={styles.testResultTitle}>
                      {dryRun.draftWon
                        ? `当たったルール：このルール「${thisRuleName}」`
                        : dryRun.winner
                          ? `当たったルール：「${dryRun.winner.name}」`
                          : 'どのルールにも当たりませんでした'}
                    </p>
                    <p className={styles.testResultNote}>
                      {dryRun.draftWon
                        ? 'このルールが返します。'
                        : dryRun.winner
                          ? `このルールは見送りです：${dryRun.winner.name}が先に動きます。動かすには、順番をそれより前にします。`
                          : '届いたメッセージや相手の条件が、どのルールにも合いませんでした。'}
                    </p>
                    {dryRun.candidates.find((c) => c.autoReplyId === autoReplyId)?.reasonCodes.length ? (
                      <p className={styles.testResultNote}>
                        見送った理由：
                        {dryRun.candidates
                          .find((c) => c.autoReplyId === autoReplyId)!
                          .reasonCodes.map((code) => REASON_WORDS[code] ?? code)
                          .join('・')}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            </>
          )}

          {step === 'confirm' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>設定の確認</h2>
                <div>
                  <SummaryRow label="名前・フォルダ" onEdit={() => goToStep('basic')}>
                    {thisRuleName}
                    {form.folderId
                      ? ` / ${folders.find((f) => f.id === form.folderId)?.name ?? '分けない'}`
                      : ' / 分けない'}
                  </SummaryRow>
                  <SummaryRow label="反応する言葉" onEdit={() => goToStep('trigger')}>
                    {form.respondToAll
                      ? 'すべてのメッセージ'
                      : effectiveKeywords.length > 0
                        ? `${effectiveKeywords.map((r) => `「${r.keyword.trim()}」`).join('')}（${matchTypeWord(form.matchType)}）`
                        : '未入力'}
                  </SummaryRow>
                  <SummaryRow label="いつ" onEdit={() => goToStep('trigger')}>
                    {[
                      form.weekdays.length === 0 || form.weekdays.length === 7
                        ? '毎日'
                        : `${form.weekdays
                            .slice()
                            .sort((a, b) => a - b)
                            .map((d) => WEEKDAY_LABELS[d])
                            .join('・')}曜`,
                      form.timeMode === 'custom' && (form.activeFrom || form.activeUntil)
                        ? `${form.activeFrom || '00:00'}〜${form.activeUntil || '24:00'}`
                        : 'いつでも',
                    ].join('・')}
                  </SummaryRow>
                  <SummaryRow label="誰に" onEdit={() => goToStep('trigger')}>
                    {form.friendTarget === 'filtered' ? '条件に合う友だち' : 'すべての友だち'}
                  </SummaryRow>
                  <SummaryRow label="返すもの" onEdit={() => goToStep('response')}>
                    {form.mode === 'silent'
                      ? '返信しない（後の処理だけ）'
                      : form.mode === 'template'
                        ? selectedTemplate
                          ? `テンプレート「${selectedTemplate.name}」`
                          : 'テンプレート（未選択）'
                        : form.mode === 'inline-flex'
                          ? 'カード'
                          : form.mode === 'inline-image'
                            ? '画像'
                            : `テキスト ${formatNumber(form.responseContent.length)}字`}
                  </SummaryRow>
                  <SummaryRow label="返したあと" onEdit={() => goToStep('response')}>
                    {form.actions.length > 0 ? `${form.actions.length}つの処理` : 'なし'}
                  </SummaryRow>
                  <SummaryRow label="細かい決まり" onEdit={() => goToStep('response')}>
                    {[
                      Number(form.replyDelaySeconds) > 0 ? `${form.replyDelaySeconds}秒待つ` : 'すぐ返す',
                      form.cooldownOn ? `${form.cooldownMinutes}分あける` : null,
                      form.skipWhenOperatorActive ? '対応中は返さない' : null,
                      form.oncePerFriend ? '1人1回' : null,
                      form.unmatchedMode === 'notify_operator' ? '外れたら担当者へ' : null,
                    ]
                      .filter(Boolean)
                      .join('・')}
                  </SummaryRow>
                  <SummaryRow label="動く順番" onEdit={() => goToStep('priority')}>
                    {myPositionLabel}
                  </SummaryRow>
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>有効にする前の確認</h2>
                {confirmState === 'loading' && <p className={styles.hint}>確かめています…</p>}
                {confirmState === 'error' && (
                  <p className={styles.hint}>
                    確認を読み込めませんでした。
                    <button
                      type="button"
                      className={styles.weekdayPreset}
                      onClick={() => autoReplyId && void loadValidation(autoReplyId)}
                    >
                      読み直す
                    </button>
                  </p>
                )}
                {confirmState === 'ready' &&
                  gates.map((gate, index) => {
                    // 見直す先：きっかけ→手順2、返す内容→手順3、テスト・競合→手順4。
                    const backTo: WizardStep =
                      index === 0 ? 'trigger' : index === 1 ? 'response' : 'priority'
                    return (
                      <div key={gate.label} className={styles.checkRow}>
                        <span
                          className={`${styles.checkIcon} ${gate.state === 'ok' ? styles.checkIconOk : gate.state === 'blocked' ? styles.checkIconWarn : ''}`}
                          aria-hidden="true"
                        >
                          {gate.state === 'ok' ? <Check size={14} /> : gate.state === 'blocked' ? <CircleAlert size={14} /> : '—'}
                        </span>
                        <div className={styles.checkBody}>
                          <p className={styles.checkTitle}>{gate.label}</p>
                          <p className={styles.checkNote}>{gate.detail}</p>
                        </div>
                        <Button type="button" size="compact" onClick={() => goToStep(backTo)}>
                          見直す
                        </Button>
                      </div>
                    )
                  })}
              </section>
            </>
          )}
        </div>

        {/* ===== 右の列：いまの状態と LINEの見え方 ===== */}
        <div className={styles.side}>
          {step === 'basic' && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>設定内容</h2>
              <dl className={styles.kvList}>
                <div className={styles.kvRow}>
                  <dt className={styles.kvKey}>状態</dt>
                  <dd className={styles.kvVal}>停止中として作ります</dd>
                </div>
                <div className={styles.kvRow}>
                  <dt className={styles.kvKey}>動く順番</dt>
                  <dd className={styles.kvVal}>いちばん下（足されます）</dd>
                </div>
                <div className={styles.kvRow}>
                  <dt className={styles.kvKey}>同時に当たるルール</dt>
                  <dd className={styles.kvVal}>手順4で確かめます</dd>
                </div>
              </dl>
              <p className={styles.hint}>
                LINEでの見え方は、届けるメッセージを決める手順から右に出ます。
              </p>
            </section>
          )}

          {step === 'trigger' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>保存したあとに、過去28日で当たった数が出ます</h2>
                <p className={styles.hint}>
                  いまの作りでは、保存する前の条件は数えられません。保存すると、このルールが動いた回数がここに出ます。
                </p>
                <dl className={styles.kvList}>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>当たった受信（過去28日）</dt>
                    <dd className={styles.kvVal}>
                      {matchedLast28Days == null ? '—' : `${formatNumber(matchedLast28Days)}件`}
                    </dd>
                  </div>
                </dl>
              </section>
              <LinePreview accountName="公式アカウント">
                <div className={styles.talkStack}>
                  <p className={styles.bubbleIn}>
                    {effectiveKeywords[0]?.keyword.trim()
                      ? `${effectiveKeywords[0].keyword.trim()}（例）`
                      : '届いたメッセージ'}
                  </p>
                  <p className={styles.bubbleMeta}>届いた側の見え方</p>
                </div>
              </LinePreview>
            </>
          )}

          {step === 'response' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>送るものの確認</h2>
                <dl className={styles.kvList}>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>返すもの</dt>
                    <dd className={styles.kvVal}>
                      {form.mode === 'silent'
                        ? '返信しない'
                        : form.mode === 'template'
                          ? selectedTemplate?.name ?? 'テンプレート'
                          : form.mode === 'inline-flex'
                            ? 'カード'
                            : form.mode === 'inline-image'
                              ? '画像'
                              : `テキスト${form.responseContent ? ` ${formatNumber(form.responseContent.length)}字` : ''}`}
                    </dd>
                  </div>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>後の処理</dt>
                    <dd className={styles.kvVal}>{form.actions.length > 0 ? `${form.actions.length}つ` : 'なし'}</dd>
                  </div>
                </dl>
              </section>
              <LinePreview accountName="公式アカウント">
                <div className={styles.talkStack}>
                  {form.mode === 'inline-image' && imageContent ? (
                    <img
                      src={imageContent.previewImageUrl}
                      alt="返信画像のプレビュー"
                      className={styles.bubbleIn}
                      style={{ padding: 0, overflow: 'hidden' }}
                    />
                  ) : (
                    <p className={styles.bubbleReply}>{replyPreviewText}</p>
                  )}
                  <p className={styles.bubbleMeta}>返す側の見え方</p>
                </div>
              </LinePreview>
            </>
          )}

          {step === 'priority' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>重なりを1件ずつ確かめる</h2>
                <p className={styles.cardNote}>すべてにチェックを付けるまで、⑤で有効にできません。</p>
                {conflicts.length === 0 ? (
                  <p className={styles.hint}>同時に当たるルールはありません。</p>
                ) : (
                  conflicts.map((conflict) => {
                    const tone = autoReplyId ? conflictTone(conflict, autoReplyId) : { label: '', losing: false }
                    return (
                      <div key={conflict.autoReplyId} className={styles.conflictRow}>
                        <Checkbox
                          checked={acknowledged.has(conflict.autoReplyId)}
                          onCheckedChange={(on) =>
                            setAcknowledged((current) => {
                              const next = new Set(current)
                              if (on) next.add(conflict.autoReplyId)
                              else next.delete(conflict.autoReplyId)
                              return next
                            })
                          }
                          aria-label={`「${conflict.name}」を確かめた`}
                        />
                        <div className={styles.conflictBody}>
                          <p className={styles.conflictName}>{conflict.name}</p>
                          <p className={styles.conflictNote}>
                            <span className={styles.conflictCertainty}>{tone.label}</span>
                            {conflict.reason ? ` — ${conflict.reason}` : ''}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
                <dl className={styles.kvList}>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>同時に当たるルール</dt>
                    <dd className={styles.kvVal}>{conflicts.length > 0 ? `${conflicts.length}つ` : 'なし'}</dd>
                  </div>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>当たる受信（過去28日）</dt>
                    <dd className={styles.kvVal}>
                      {matchedLast28Days == null ? '—' : `${formatNumber(matchedLast28Days)}件`}
                    </dd>
                  </div>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>試した結果</dt>
                    <dd className={styles.kvVal}>
                      {dryRun ? (dryRun.draftWon ? 'このルールが返す' : '見送り') : 'まだ試していません'}
                    </dd>
                  </div>
                </dl>
              </section>
              <LinePreview accountName="公式アカウント">
                <div className={styles.talkStack}>
                  {testMessage.trim() ? <p className={styles.bubbleIn}>{testMessage.trim()}</p> : null}
                  <p className={styles.bubbleReply}>
                    {dryRun?.winner?.responseContent || replyPreviewText}
                  </p>
                  {dryRun?.winner && dryRun.winner.autoReplyId !== autoReplyId ? (
                    <p className={styles.bubbleMeta}>「{dryRun.winner.name}」が返します</p>
                  ) : (
                    <p className={styles.bubbleMeta}>このルールが返します</p>
                  )}
                </div>
              </LinePreview>
            </>
          )}

          {step === 'confirm' && (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>設定内容</h2>
                <dl className={styles.kvList}>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>状態</dt>
                    <dd className={styles.kvVal}>
                      {isActive ? '有効のまま更新' : '停止中 → 有効にします'}
                    </dd>
                  </div>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>動く順番</dt>
                    <dd className={styles.kvVal}>{myPositionLabel}</dd>
                  </div>
                  <div className={styles.kvRow}>
                    <dt className={styles.kvKey}>同時に当たるルール</dt>
                    <dd className={styles.kvVal}>
                      {conflicts.length > 0 ? `${conflicts.length}つ` : 'なし'}
                    </dd>
                  </div>
                </dl>
              </section>
              <LinePreview accountName="公式アカウント">
                <div className={styles.talkStack}>
                  <p className={styles.bubbleReply}>{replyPreviewText}</p>
                  <p className={styles.bubbleMeta}>返す側の見え方</p>
                </div>
              </LinePreview>
            </>
          )}
        </div>
      </div>

      {/* ===== 下の帯 ===== */}
      <StickyBar
        destructive={
          <Button
            type="button"
            onClick={() => guarded(() => router.push('/auto-replies'))}
            disabled={saving}
          >
            キャンセル
          </Button>
        }
        status={dirty ? '下書きに未保存の変更があります' : undefined}
        actions={
          <>
            <Button
              type="button"
              onClick={() =>
                void saveDraftNow().then((saved) => {
                  if (saved || autoReplyId) setSaveNotice('下書きを保存しました')
                })
              }
              disabled={saving}
              busy={saving}
              busyLabel="保存中…"
              done={saveDone}
            >
              {step === 'confirm' ? '下書きのまま保存' : '下書きとして保存'}
            </Button>
            {step !== 'confirm' ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => void goNext()}
                disabled={saving}
                busy={saving}
                busyLabel="進んでいます…"
              >
                次へ：{STEP_LABELS_V8[STEP_ORDER[STEP_ORDER.indexOf(step) + 1]]}
                <ChevronRight size={14} aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => void publish()}
                disabled={!publishReady || saving}
                busy={saving}
                busyLabel="有効にしています…"
                done={saveDone}
              >
                <Power size={14} aria-hidden="true" />
                {wasPublished || isActive ? 'この内容で更新する' : '有効にする'}
              </Button>
            )}
          </>
        }
      />

      <ConfirmDialog
        open={compareTarget !== null || compareError !== ''}
        title="最新の保存と比べる"
        description="あなたの下書きと、相手が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
        confirmLabel="最新を読み込んで続ける"
        busy={compareBusy}
        error={compareError || undefined}
        onConfirm={() => void reloadAfterConflict()}
        onCancel={() => {
          setCompareTarget(null)
          setCompareError('')
        }}
      >
        {compareTarget && (() => {
          const lines = describeAutoReplyDiff(form, compareTarget)
          return lines.length === 0 ? (
            <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {lines.map((line, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span aria-hidden className="text-accent-deep font-bold">・</span>
                  <span className="text-ink">{line}</span>
                </li>
              ))}
            </ul>
          )
        })()}
      </ConfirmDialog>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="自動応答の変更"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
        busy={saving}
        onSave={async () => {
          const saved = await saveDraftNow()
          return saved !== null
        }}
      />
    </div>
  )
}

function SummaryRow({
  label,
  onEdit,
  children,
}: {
  label: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryKey}>{label}</span>
      <span className={styles.summaryVal}>{children}</span>
      <Button type="button" size="compact" onClick={onEdit}>
        変える
      </Button>
    </div>
  )
}

/** 反応する言葉の追加入力。Enter・カンマ・離れると確定する。 */
function KeywordInput({ onAdd }: { onAdd: (word: string) => void }) {
  const [value, setValue] = useState('')
  const commit = () => {
    if (value.trim()) {
      onAdd(value)
      setValue('')
    }
  }
  return (
    <input
      className={styles.chipInput}
      value={value}
      placeholder="言葉を入れて Enter"
      aria-label="反応する言葉を足す"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault()
          commit()
        }
      }}
      onBlur={commit}
    />
  )
}

export default function AutoReplyWizardV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoReplyWizardV8Inner />
    </Suspense>
  )
}
