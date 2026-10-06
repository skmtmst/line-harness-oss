'use client'

/*
 * ★V8 友だち追加時の配信を作る・直す（Pencil：作る①基本設定 `wDzkc` → ②流入リンク `h8uNW`
 * （1152 `xHpkS`）→ ③初回案内 `al47K` → ④あわせて行うこと `i1nThZ` → ⑤確認 `U8Xm3X`、
 * 編集の競合 `h5rm8t`）。
 *
 * 型（CreatePage）に、戻る・題・手順の輪・説明・左の段（カード）・右の「設定内容」と
 * LINEでの見え方・下に追従する帯（キャンセル・下書きを保存・次へ）を渡す。
 *
 * 読み・保存・テスト・離脱の番兵は app/friend-add-settings/editor-v8.tsx と同じ
 * （口・版・下書き・冪等の鍵の扱いを変えない）。違うのは見せ方と、先に保存された
 * ときの帯（違いを比べる・最新を読み込んで続ける）。BEHAVIOR.md に書き出した。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Ban,
  Braces,
  CircleAlert,
  CircleCheck,
  FileText,
  IdCard,
  ListChecks,
  Pencil,
  Plus,
  Power,
  Route,
  Search,
  User,
  UserPlus,
  UserRound,
  Workflow,
} from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import { CreatePreviewNote, CreateSummaryCard } from '@/components/templates/create-parts'
import Stepper, { type StepperStep } from '@/components/shared/stepper'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import CheckCard from '@/components/shared/check-card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ConditionBuilder from '@/components/shared/condition-builder'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import type { SegmentCondition } from '@/lib/segment-condition'
import { pruneCondition } from '@/lib/segment-condition'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import type {
  FriendAddRule,
  FriendAddRuleAction,
  FriendAddRuleDefinition,
  FriendAddRuleKind,
  FriendAddRuleOptions,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { describeFriendAddFailure } from './failure'
import { addTimeWindow, MESSAGE_TYPE_LABEL, removeTimeWindow, updateTimeWindow } from './flow'
import { resendSuppressionText } from './text'
import styles from './editor.module.css'

type Step = 'basic' | 'routes' | 'message' | 'actions' | 'preview'
type EditorRule = {
  name: string
  folderName: string | null
  priority: number
  friendKind: FriendAddRuleKind
  isFallback: boolean
  status: string
  matchedLast7Days: number | null
  lastTestStatus: string | null
  version: number
}
/** 流入リンクを使っているほかの設定（「いま〇〇（順番N）が動いています」）。 */
type RouteUse = { ruleId: string; name: string; priority: number }

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'
const MESSAGE_LIMIT = 5000
/* 手順の輪の文言は板どおり。 */
const STEPS: Array<{ key: Step; label: string; node: string }> = [
  { key: 'basic', label: '基本設定', node: 'wDzkc' },
  { key: 'routes', label: '流入リンク', node: 'h8uNW' },
  { key: 'message', label: '初回案内', node: 'al47K' },
  { key: 'actions', label: 'あわせて行うこと', node: 'i1nThZ' },
  { key: 'preview', label: '確認', node: 'U8Xm3X' },
]

const EMPTY_DEFINITION: FriendAddRuleDefinition = {
  routeIds: [],
  scenarioId: null,
  messageType: 'text',
  messageText: '',
  timing: 'immediate',
  actions: [],
  friendCondition: '',
  internalMemo: '',
  activeFrom: null,
  activeUntil: null,
  deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
  resendSuppressionHours: 24,
  startPosition: 'beginning',
  unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeWindows: [{ start: '08:00', end: '21:00' }],
}

/** 保存済みかの比較には版番号を含めない（v7 の編集器と同じ）。 */
function editorSnapshot(rule: EditorRule, definition: FriendAddRuleDefinition) {
  return JSON.stringify({
    name: rule.name,
    folderName: rule.folderName,
    priority: rule.priority,
    friendKind: rule.friendKind,
    isFallback: rule.isFallback,
    definition,
  })
}

function toEditorRule(rule: FriendAddRule): EditorRule {
  return {
    name: rule.name,
    folderName: rule.folderName,
    priority: rule.priority,
    friendKind: rule.friendKind,
    isFallback: rule.isFallback,
    status: rule.status,
    matchedLast7Days: rule.matchedLast7Days,
    lastTestStatus: rule.lastTestStatus,
    version: rule.version,
  }
}

/** 日時の欄（datetime-local）の値。保存値の秒・時差は落として見せる。 */
function localInputValue(value: string | null) {
  if (!value) return ''
  return value.slice(0, 16)
}

/** 友だち条件の1行の言い方（タグの有無だけ名前で言う。ほかは件数）。 */
function conditionSummary(condition: SegmentCondition | null, tags: FriendAddRuleOptions['tags']) {
  if (!condition || condition.rules.length + (condition.groups?.length ?? 0) === 0) return '友だち条件：なし（全員）'
  const tagName = (value: unknown) => {
    const id = typeof value === 'string' ? value : (value as { tagId?: string } | null)?.tagId
    return tags.find((tag) => tag.id === id)?.name ?? null
  }
  const parts = condition.rules.map((rule) => {
    const name = tagName(rule.value)
    if (rule.type === 'tag_exists' && name) return `タグ「${name}」が付いている`
    if (rule.type === 'tag_not_exists' && name) return `タグ「${name}」が付いていない`
    return null
  })
  if (parts.length === 1 && parts[0] && !condition.groups?.length) return `友だち条件：${parts[0]}`
  return `友だち条件：${condition.rules.length + (condition.groups?.length ?? 0)}つ`
}

function parseFriendConditionJson(value: string): SegmentCondition | null {
  const raw = value.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SegmentCondition
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (parsed.operator !== 'AND' && parsed.operator !== 'OR') return null
    if (!Array.isArray(parsed.rules)) return null
    return parsed
  } catch {
    return null
  }
}

export default function FriendAddEditorV8({ ruleId }: { ruleId?: string }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddEditor ruleId={ruleId} />
    </Suspense>
  )
}

function FriendAddEditor({ ruleId }: { ruleId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const narrow = useNarrowViewport()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const accountName = accounts.find((account) => account.id === selectedAccountId)?.name ?? '公式アカウント'
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const requestedStep = searchParams.get('step') as Step | null
  const step: Step = STEPS.some((item) => item.key === requestedStep) ? requestedStep! : 'basic'
  usePageTitle('初回案内を作る')
  const [rule, setRule] = useState<EditorRule>({
    name: '', folderName: null, priority: 1, friendKind: 'first_time', isFallback: false,
    status: 'draft', matchedLast7Days: null, lastTestStatus: null, version: 0,
  })
  const [definition, setDefinition] = useState<FriendAddRuleDefinition>(EMPTY_DEFINITION)
  const [options, setOptions] = useState<FriendAddRuleOptions>({ routes: [], scenarios: [], tags: [], folders: [] })
  const [routeUses, setRouteUses] = useState<Map<string, RouteUse>>(new Map())
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null)
  const [validateChecks, setValidateChecks] = useState<Array<{ key: string; status: string; detail: string }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /* 先にほかの人が保存したとき（版の競合）。保存はせず、違いを比べるか最新を読むかを選ぶ。 */
  const [conflict, setConflict] = useState(false)
  const [compare, setCompare] = useState<Array<{ label: string; mine: string; theirs: string }> | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [testResult, setTestResult] = useState<{
    accountId: string
    ruleId: string
    snapshot: string
    matched: boolean
    reasons: string[]
    stateChanged: false
  } | null>(null)
  const saveIdempotencyKey = useRef(crypto.randomUUID())
  const saveInFlight = useRef(false)
  const savedSnapshot = useRef<string | null>(null)
  const loadRequestRef = useRef({ accountId: null as string | null, ruleId: null as string | null, generation: 0 })
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setLoading(false); return }
    const request = {
      accountId: selectedAccountId,
      ruleId: ruleId ?? null,
      generation: loadRequestRef.current.generation + 1,
    }
    loadRequestRef.current = request
    const isCurrentRequest = () =>
      loadRequestRef.current.accountId === request.accountId
      && loadRequestRef.current.ruleId === request.ruleId
      && loadRequestRef.current.generation === request.generation
    setLoading(true)
    setError('')
    try {
      let kind: FriendAddRuleKind = 'first_time'
      if (ruleId) {
        const response = await api.friendAddRules.get(request.accountId, ruleId)
        if (!isCurrentRequest()) return
        if (!response.success) { setError(response.error); return }
        const loadedRule = toEditorRule(response.data.rule)
        kind = loadedRule.friendKind
        setRule(loadedRule)
        setDefinition(response.data.rule.definition)
        savedSnapshot.current = editorSnapshot(loadedRule, response.data.rule.definition)
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        setSlackConnected(response.data.staffNotification?.status === 'connected' ? true : response.data.staffNotification?.status == null ? null : false)
      }
      /* 一覧の口から、流入リンクを使っているほかの設定と（作るときは）並びの位置を読む。 */
      const listResponse = await api.friendAddRules.list(request.accountId, kind)
      if (!isCurrentRequest()) return
      if (listResponse.success) {
        const uses = new Map<string, RouteUse>()
        for (const item of listResponse.data.items) {
          if (item.id === ruleId || item.isFallback || item.status !== 'published') continue
          for (const id of item.definition.routeIds) {
            if (!uses.has(id)) uses.set(id, { ruleId: item.id, name: item.name, priority: item.priority })
          }
        }
        setRouteUses(uses)
        if (!ruleId) {
          setOptions({ ...listResponse.data.options, folders: listResponse.data.options.folders ?? [] })
          const conflictRes = await api.friendAddRules.conflicts(request.accountId, 'first_time')
          if (!isCurrentRequest()) return
          const fallbackIds = new Set(listResponse.data.items.filter((item) => item.isFallback).map((item) => item.id))
          const maxPriority = conflictRes.success
            ? conflictRes.data.rules.reduce((max, item) => (fallbackIds.has(item.id) ? max : Math.max(max, item.priority)), 0)
            : listResponse.data.items.filter((item) => !item.isFallback).length
          setRule((current) => {
            const initialRule = { ...current, priority: Math.max(1, maxPriority + 1) }
            savedSnapshot.current = editorSnapshot(initialRule, EMPTY_DEFINITION)
            return initialRule
          })
        }
      } else if (!ruleId) {
        setError(listResponse.error)
        return
      }
      setLoadedAccountId(request.accountId)
    } catch (caught) {
      if (isCurrentRequest()) setError(describeFriendAddFailure(caught, '設定', 'load').message)
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [ruleId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const currentIndex = STEPS.findIndex((item) => item.key === step)
  const hrefFor = (next: Step, extra = '') => ruleId
    ? `/friend-add-settings?view=edit&id=${encodeURIComponent(ruleId)}&step=${next}${extra}`
    : `/friend-add-settings?view=new&step=${next}${extra}`
  const input = () => {
    if (!selectedAccountId || loadedAccountId !== selectedAccountId) return null
    return {
      accountId: selectedAccountId,
      friendKind: rule.friendKind,
      name: rule.name,
      folderName: rule.folderName,
      priority: rule.priority,
      version: rule.version,
      definition,
    }
  }

  const hasUnsavedChanges = savedSnapshot.current !== null
    && savedSnapshot.current !== editorSnapshot(rule, definition)

  /* 未保存の変更がある間、画面外への離脱を確認対話へ寄せる。 */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: hasUnsavedChanges, busy: saving || enabling })

  const validateStep = (target: Step) => {
    const skipsScenario = rule.friendKind === 'returning' && definition.returningMode === 'none'
    const scenarioProblem = !definition.scenarioId && !skipsScenario
      ? '実際に配信するシナリオを決めてください。'
      : ''
    const routesProblem = !rule.isFallback && definition.routeIds.length === 0
      ? '対象にする流入リンクを1つ以上選んでください。'
      : ''
    if (target === 'basic') return ''
    if (target === 'routes') return routesProblem
    if (target === 'message') return scenarioProblem
    if (target === 'actions') return ''
    return scenarioProblem || routesProblem
  }
  const [fieldError, setFieldError] = useState<{ step: Step; message: string } | null>(null)
  useEffect(() => { setFieldError(null) }, [rule, definition])

  const save = async (nextStep?: Step): Promise<string | null> => {
    if (saveInFlight.current) return null
    const payload = input()
    if (!payload) {
      setError(selectedAccountId && loadedAccountId !== selectedAccountId
        ? 'アカウントを切り替えています。読み込みが終わってから保存してください。'
        : 'LINE公式アカウントを選んでください。')
      return null
    }
    if (!rule.name.trim()) {
      const message = '設定名を入力してください。'
      if (step === 'basic') setFieldError({ step, message })
      else setError(message)
      return null
    }
    if (nextStep && STEPS.findIndex((item) => item.key === nextStep) >= currentIndex) {
      const problem = validateStep(step)
      if (problem) { setFieldError({ step, message: problem }); return null }
    }
    setFieldError(null)
    saveInFlight.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = ruleId
        ? await api.friendAddRules.saveDraft(ruleId, payload, saveIdempotencyKey.current)
        : await api.friendAddRules.createDraft(payload, saveIdempotencyKey.current)
      if (!response.success) { setError(response.error); return null }
      const savedId = response.data.id
      saveIdempotencyKey.current = crypto.randomUUID()
      const savedVersion = (response.data as { version?: number }).version
      if (typeof savedVersion === 'number') {
        setRule((current) => ({ ...current, version: savedVersion }))
      }
      savedSnapshot.current = editorSnapshot(rule, definition)
      setConflict(false)
      setNotice('下書きを保存しました。')
      if (!ruleId || nextStep) router.replace(`/friend-add-settings?view=edit&id=${encodeURIComponent(savedId)}&step=${nextStep ?? step}`)
      return savedId
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
      } else {
        setError(describeSaveFailure(caught))
      }
      return null
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  /* 競合：最新を読み込んで続ける（いまの直しは捨てる）。 */
  const reloadAfterConflict = async () => {
    setConflict(false)
    setCompare(null)
    await load()
  }

  /* 競合：違いを比べる（最新の保存とあなたの直しを、項目ごとに並べる）。 */
  const openCompare = async () => {
    if (!ruleId || !selectedAccountId) return
    setCompareBusy(true)
    try {
      const response = await api.friendAddRules.get(selectedAccountId, ruleId)
      if (!response.success) { setError(response.error); return }
      const latest = response.data.rule
      const routeText = (ids: string[]) => ids
        .map((id) => options.routes.find((route) => route.id === id)?.name ?? id)
        .join('・') || '未選択'
      const rows = [
        { label: '設定名', mine: rule.name, theirs: latest.name },
        { label: 'フォルダ', mine: rule.folderName ?? '未分類', theirs: latest.folderName ?? '未分類' },
        { label: '流入リンク', mine: routeText(definition.routeIds), theirs: routeText(latest.definition.routeIds) },
        { label: '最初に送るもの', mine: definition.messageText, theirs: latest.definition.messageText },
        { label: 'あわせて行うこと', mine: definition.actions.map((a) => a.label).join('・') || 'なし', theirs: latest.definition.actions.map((a) => a.label).join('・') || 'なし' },
      ].filter((row) => row.mine !== row.theirs)
      setCompare(rows)
    } catch (caught) {
      setError(describeFriendAddFailure(caught, '設定', 'load').message)
    } finally {
      setCompareBusy(false)
    }
  }

  const moveToStep = (nextStep: Step) => {
    if (nextStep === step || saving || enabling) return
    if (!hasUnsavedChanges) {
      router.replace(hrefFor(nextStep))
      return
    }
    void save(nextStep)
  }

  const runTest = async () => {
    const activeId = ruleId ?? await save('preview')
    if (!activeId || !selectedAccountId || loadedAccountId !== selectedAccountId) return
    setSaving(true)
    setError('')
    try {
      const response = await api.friendAddRules.test(selectedAccountId, activeId, { routeId: null, expectedAt: null, friendId: null })
      const testedMeta = {
        accountId: selectedAccountId,
        ruleId: activeId,
        snapshot: savedSnapshot.current ?? editorSnapshot(rule, definition),
      }
      if (!response.success) {
        if ('data' in response && response.data) setTestResult({ ...testedMeta, ...response.data })
        setError(response.error)
        return
      }
      setTestResult({ ...testedMeta, ...response.data })
      setNotice('テストが完了しました。本番の登録・送信・タグ・マイルは変更していません。')
    } catch {
      setError('テストを実行できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  /* 確認段の「有効にする前の確認」はサーバの検証を読む（公開の面と同じ口）。 */
  const [overlapNotes, setOverlapNotes] = useState<string[]>([])
  useEffect(() => {
    if (step !== 'preview' || !ruleId || !selectedAccountId || loadedAccountId !== selectedAccountId) return
    let alive = true
    void (async () => {
      try {
        const res = await api.friendAddRules.validate(selectedAccountId, ruleId)
        if (!alive || !res.success) return
        setValidateChecks(res.data.checks.map((check) => ({ key: check.key, status: check.status, detail: check.detail })))
      } catch {
        /* 読めないときはテストの行だけを見る。 */
      }
    })()
    return () => { alive = false }
  }, [step, ruleId, selectedAccountId, loadedAccountId])
  useEffect(() => {
    if (step !== 'preview' || !selectedAccountId) return
    let alive = true
    void (async () => {
      try {
        const res = await api.friendAddRules.conflicts(selectedAccountId, rule.friendKind)
        if (!alive || !res.success) return
        setOverlapNotes(res.data.conflicts.map((item) => item.message))
      } catch {
        /* 読めないときは重なりの行を出さない。 */
      }
    })()
    return () => { alive = false }
  }, [step, selectedAccountId, rule.friendKind])

  /* 「有効にする」：検証が通り、テストで判定が通ったときだけ押せる。 */
  const testOk = testResult
    && testResult.accountId === selectedAccountId
    && testResult.ruleId === (ruleId ?? testResult.ruleId)
    && testResult.snapshot === editorSnapshot(rule, definition)
    && testResult.matched
  const overlapOk = (validateChecks === null || !validateChecks.some((check) => check.status !== 'passed')) && overlapNotes.length === 0
  const canEnable = Boolean(ruleId && canEdit && testOk && overlapOk && !saving && !enabling)

  const enableRule = async () => {
    const activeId = ruleId ?? await save('preview')
    if (!activeId || !selectedAccountId || loadedAccountId !== selectedAccountId || enabling) return
    setEnabling(true)
    setError('')
    try {
      const res = await api.friendAddRules.publish(selectedAccountId, activeId, saveIdempotencyKey.current)
      if (!res.success) {
        setError('有効化できませんでした。状態を読み直してから、もう一度お試しください。')
        return
      }
      router.replace(`/friend-add-settings/publish?id=${encodeURIComponent(activeId)}&done=1`)
    } catch {
      setError('有効化できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setEnabling(false)
    }
  }

  const toggleRoute = (id: string) => setDefinition((current) => ({
    ...current,
    routeIds: current.routeIds.includes(id) ? current.routeIds.filter((routeId) => routeId !== id) : [...current.routeIds, id],
  }))

  const routeNames = useMemo(() => definition.routeIds
    .map((id) => options.routes.find((route) => route.id === id)?.name)
    .filter((name): name is string => Boolean(name)), [definition.routeIds, options.routes])

  if (accountLoading || loading) return <ListState kind="loading" title="設定を読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで対象を選ぶと設定を表示します。' : '先にLINE公式アカウントを登録してください。'} />
  if (loadedAccountId !== selectedAccountId) {
    return error
      ? <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />
      : <ListState kind="loading" title="設定を読み込んでいます" />
  }
  if (error && !rule.name && ruleId) return <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />

  /* ===== 右の列：設定内容と LINE での見え方 ===== */
  const noneMode = rule.friendKind === 'returning' && definition.returningMode === 'none'
  const textReady = definition.messageType === 'text' && definition.messageText
  const firstSend = noneMode
    ? '配信なし'
    : textReady
      ? step === 'actions' || step === 'preview'
        ? `テキスト＋${definition.actions.length}つの処理`
        : `テキスト ${definition.messageText.length}字`
      : step === 'basic' || step === 'routes'
        ? '手順3で作る'
        : MESSAGE_TYPE_LABEL[definition.messageType] ?? '未設定'
  const statusLabel = rule.status === 'published' ? '有効' : rule.status === 'stopped' ? '停止中' : '下書き'
  const routeSummary = step === 'basic'
    ? '手順2で選ぶ'
    : routeNames.length === 0
      ? '未選択'
      : routeNames.length === 1
        ? routeNames[0]
        : `${routeNames.length}つ（${sharedPrefix(routeNames) || routeNames[0]}）`
  const summary = (
    <CreateSummaryCard rows={[
      { label: 'だれに', value: rule.friendKind === 'returning' ? '以前からの友だち' : 'はじめての人' },
      { label: '流入リンク', value: routeSummary },
      { label: '最初に送るもの', value: firstSend },
      { label: '状態', value: step === 'preview' ? `${statusLabel} → 有効にする` : statusLabel },
    ]} />
  )
  const phone = (
    <LinePreview
      accountName={accountName}
      caption={textReady || noneMode ? undefined : '友だち追加しました'}
      empty={textReady || noneMode ? false : '初回案内は手順3で作ります'}
    >
      {textReady || noneMode ? (
        <>
          <p className={styles.talkChip}><span>友だち追加しました</span></p>
          <LinePreviewMessage accountName={accountName} avatar={accountName.slice(0, 1)} time="今">
            {noneMode ? '再追加では配信しません。案内後の操作だけを行います。' : definition.messageText}
          </LinePreviewMessage>
        </>
      ) : null}
    </LinePreview>
  )
  /* 1152（xHpkS）：見え方は「LINEでの見え方を見る」で開き、列には設定内容だけを置く。 */
  const preview = step === 'basic' ? (
    <>
      {summary}
      <CreatePreviewNote>LINEでの見え方は、届けるメッセージを決める手順から右に出ます。</CreatePreviewNote>
    </>
  ) : narrow ? (
    <>
      <div className={styles.narrowSide}>
        <div className={styles.previewOpen}>
          <Button type="button" onClick={() => setPreviewOpen(true)}>LINEでの見え方を見る</Button>
        </div>
        {summary}
      </div>
    </>
  ) : (
    <>
      {summary}
      {phone}
    </>
  )

  const nextStep = STEPS[Math.min(currentIndex + 1, STEPS.length - 1)]
  const stepperSteps: StepperStep[] = STEPS.map((item, index) => ({
    key: item.key,
    label: item.label,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
    onSelect: index !== currentIndex ? () => moveToStep(item.key) : undefined,
  }))

  return (
    <CreatePage
      boardId={step === 'routes' && narrow ? 'xHpkS' : conflict ? 'h5rm8t' : STEPS[currentIndex].node}
      title="初回案内を作る"
      identity={
        <Link href="/friend-add-settings" className={styles.backLink}>← 友だち追加時の配信へ</Link>
      }
      steps={<Stepper label="初回案内の作る手順" steps={stepperSteps} currentKey={step} />}
      description={<>
        {step === 'basic'
          ? 'いまは下書きとして作ります。最後の「確認」で有効にします。'
          : `名前：${rule.name || '（未入力）'}・いまは${statusLabel}です`}
        {/* 先に保存されたとき（h5rm8t）：頭の中、説明の下に横いっぱいの帯。 */}
        {conflict ? (
          <div className={styles.conflictBand} role="alert">
            <CircleAlert size={18} aria-hidden="true" className={styles.conflictIcon} />
            <div className={styles.conflictText}>
              <p className={styles.conflictTitle}>ほかの人が先に初回案内「{rule.name}」を保存しました</p>
              <p className={styles.conflictDesc}>あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。</p>
            </div>
            <div className={styles.conflictActions}>
              <Button type="button" onClick={() => void openCompare()} disabled={compareBusy} busy={compareBusy} busyLabel="比べています…">違いを比べる</Button>
              <Button type="button" variant="primary" onClick={() => void reloadAfterConflict()}>最新を読み込んで続ける</Button>
            </div>
          </div>
        ) : null}
      </>}
      preview={preview}
      footerActions={canEdit ? (
        <>
          <Button href="/friend-add-settings">キャンセル</Button>
          <Button type="button" disabled={saving || enabling} busy={saving} busyLabel="保存中…" onClick={() => void save()}>下書きを保存</Button>
          {step === 'preview' ? (
            <Button
              type="button"
              variant="primary"
              disabled={!canEnable}
              title={!testOk ? 'テストで判定が通るまで、有効にはできません' : !overlapOk ? '確認の直しを終えてから有効にできます' : undefined}
              busy={enabling}
              busyLabel="有効化中…"
              onClick={() => void enableRule()}
            >
              <Power size={14} aria-hidden="true" />有効にする
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled={saving || enabling} onClick={() => moveToStep(nextStep.key)}>
              次へ：{nextStep.label}
              <ArrowRight size={15} aria-hidden="true" />
            </Button>
          )}
        </>
      ) : (
        /* 閲覧のみ：変える操作（保存・次へ・有効にする）は置かない。 */
        <Button href="/friend-add-settings">一覧へ戻る</Button>
      )}
    >
      {!canEdit ? (
        <p className={styles.viewerBand} role="status">閲覧のみで見ています。変える操作は管理者に頼んでください。</p>
      ) : null}
      {error ? <Notice tone="danger" message={error} onClose={() => setError('')} /> : null}
      {notice ? <Notice tone="success" message={notice} onClose={() => setNotice('')} /> : null}

      {step === 'basic' ? (
        <BasicStep
          rule={rule}
          setRule={setRule}
          options={options}
          canEdit={canEdit}
          isExisting={Boolean(ruleId)}
          nameError={fieldError?.step === 'basic' ? fieldError.message : undefined}
        />
      ) : null}
      {step === 'routes' ? (
        <RoutesStep
          rule={rule}
          definition={definition}
          setDefinition={setDefinition}
          options={options}
          routeUses={routeUses}
          toggleRoute={toggleRoute}
          canEdit={canEdit}
          routeError={fieldError?.step === 'routes' ? fieldError.message : undefined}
        />
      ) : null}
      {step === 'message' ? (
        <MessageStep definition={definition} setDefinition={setDefinition} friendKind={rule.friendKind} scenarios={options.scenarios} canEdit={canEdit} />
      ) : null}
      {step === 'actions' ? (
        <ActionsStep definition={definition} setDefinition={setDefinition} options={options} canEdit={canEdit} />
      ) : null}
      {step === 'preview' ? (
        <PreviewStep
          rule={rule}
          definition={definition}
          routeNames={routeNames}
          runTest={runTest}
          testing={saving}
          testOk={Boolean(testOk)}
          overlapNotes={overlapNotes}
          slackConnected={slackConnected}
          canEdit={canEdit}
          hrefFor={hrefFor}
        />
      ) : null}

      <ConfirmDialog
        open={previewOpen}
        title="LINEでの見え方"
        description="友だち追加した人に届くメッセージの見え方です。"
        confirmLabel="閉じる"
        onConfirm={() => setPreviewOpen(false)}
        onCancel={() => setPreviewOpen(false)}
      >
        {phone}
      </ConfirmDialog>
      <ConfirmDialog
        open={compare !== null}
        title="最新の保存とあなたの直しの違い"
        description={compare && compare.length === 0 ? '項目の違いはありません。最新を読み込んで続けてください。' : '左があなたの直し、右が先に保存された内容です。'}
        confirmLabel="最新を読み込んで続ける"
        onConfirm={() => void reloadAfterConflict()}
        onCancel={() => setCompare(null)}
      >
        {compare && compare.length > 0 ? (
          <dl className={styles.compareRows}>
            {compare.map((row) => (
              <div key={row.label} className={styles.compareRow}>
                <dt>{row.label}</dt>
                <dd title={row.mine}>{row.mine || '（空）'}</dd>
                <dd title={row.theirs}>{row.theirs || '（空）'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </ConfirmDialog>
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="追加時の動きへの変更"
        busy={saving || enabling}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </CreatePage>
  )
}

/** 名前の共通の頭（「秋フェア チラシ」「秋フェア 店頭ポスター」→「秋フェア」）。 */
function sharedPrefix(names: string[]) {
  const words = names.map((name) => name.split(/[\s　]/)[0])
  return words.every((word) => word === words[0]) && words[0] !== names[0] ? words[0] : ''
}

/* ===== 作る① 基本設定（板 `wDzkc`） ===== */

function BasicStep({ rule, setRule, options, canEdit, isExisting, nameError }: {
  rule: EditorRule
  setRule: Dispatch<SetStateAction<EditorRule>>
  options: FriendAddRuleOptions
  canEdit: boolean
  isExisting: boolean
  nameError?: string
}) {
  const locked = rule.isFallback || isExisting
  const folderOptions = options.folders.some((folder) => folder.name === (rule.folderName ?? ''))
    ? options.folders
    : rule.folderName ? [...options.folders, { id: rule.folderName, name: rule.folderName }] : options.folders
  const lockReason = !canEdit ? READONLY_REASON : locked ? '保存したあとの設定では変えられません' : undefined
  return (
    <>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="名前とフォルダ">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>名前とフォルダ</h2>
          <p className={styles.cardDesc}>一覧に出る名前です。友だちには見えません。</p>
        </div>
        <div className={styles.fieldPair}>
          <div className={styles.field}>
            <label htmlFor="fa-name" className={styles.label}>設定名（60文字まで）</label>
            <TextField
              id="fa-name"
              value={rule.name}
              maxLength={60}
              disabled={!canEdit}
              invalid={Boolean(nameError)}
              placeholder="例：秋フェアの初回案内"
              onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))}
            />
            {nameError ? <span className={styles.fieldError} role="alert">{nameError}</span> : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="fa-folder" className={styles.label}>フォルダ</label>
            <Select
              id="fa-folder"
              aria-label="フォルダ"
              size="full"
              value={rule.folderName ?? ''}
              disabled={!canEdit}
              onChange={(value) => setRule((current) => ({ ...current, folderName: value || null }))}
              options={[
                { value: '', label: '未分類' },
                ...folderOptions.map((folder) => ({ value: folder.name, label: folder.name })),
              ]}
            />
          </div>
        </div>
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="だれに送るか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>だれに送るか</h2>
          <p className={styles.cardDesc}>保存したあとは変えられません</p>
        </div>
        <RadioCardGroup legend="だれに送るか" className={styles.kindPair}>
          <RadioCard
            name="fa-kind"
            value="first_time"
            checked={rule.friendKind === 'first_time'}
            disabled={!canEdit || locked}
            disabledReason={rule.friendKind === 'first_time' ? undefined : lockReason}
            onChange={() => setRule((current) => ({ ...current, friendKind: 'first_time' }))}
            icon={<UserPlus size={16} />}
            title="はじめて友だち追加した人"
            note="初めての人にだけ「はじめまして」"
            className={styles.kindCard}
          />
          <RadioCard
            name="fa-kind"
            value="returning"
            checked={rule.friendKind === 'returning'}
            disabled={!canEdit || locked}
            disabledReason={rule.friendKind === 'returning' ? undefined : lockReason}
            onChange={() => setRule((current) => ({ ...current, friendKind: 'returning' }))}
            icon={<UserRound size={16} />}
            title="以前からの友だち・ブロック解除した人"
            note="戻ってきた人には別の案内"
            className={styles.kindCard}
          />
        </RadioCardGroup>
        <Notice tone="info" icon={<CircleAlert size={16} aria-hidden="true" />} message="この2つを分けないと、以前からのお客さまに「はじめまして」が届きます。" />
      </Card>
    </>
  )
}

/* ===== 作る② 流入リンク（板 `h8uNW`・1152 `xHpkS`） ===== */

function RoutesStep({ rule, definition, setDefinition, options, routeUses, toggleRoute, canEdit, routeError }: {
  rule: EditorRule
  definition: FriendAddRuleDefinition
  setDefinition: Dispatch<SetStateAction<FriendAddRuleDefinition>>
  options: FriendAddRuleOptions
  routeUses: Map<string, RouteUse>
  toggleRoute: (id: string) => void
  canEdit: boolean
  routeError?: string
}) {
  const [query, setQuery] = useState('')
  const [conditionOpen, setConditionOpen] = useState(false)
  const keyword = query.trim()
  /* 選んだリンクを上に。並びは選んだ順ではなく、口の並びのまま。 */
  const visibleRoutes = useMemo(() => {
    const filtered = keyword ? options.routes.filter((route) => route.name.includes(keyword)) : options.routes
    const chosen = filtered.filter((route) => definition.routeIds.includes(route.id))
    return [...chosen, ...filtered.filter((route) => !definition.routeIds.includes(route.id))]
  }, [definition.routeIds, keyword, options.routes])
  const selectedCount = definition.routeIds.length
  const raw = definition.friendCondition ?? ''
  const parsed = parseFriendConditionJson(raw)
  const legacy = raw.trim() !== '' && parsed === null
  return (
    <>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="どの流入リンクから来た人に送るか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>どの流入リンクから来た人に送るか</h2>
          <p className={styles.cardDesc}>選んだリンクの URL・QR（どちらも同じ入口）から追加された人に動きます</p>
        </div>
        <label className={styles.routeSearch}>
          <Search size={14} aria-hidden="true" />
          <input
            className={styles.routeSearchInput}
            value={query}
            placeholder="流入リンクの名前で探す"
            aria-label="流入リンクの名前で探す"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {visibleRoutes.map((route) => {
          const checked = definition.routeIds.includes(route.id)
          const use = routeUses.get(route.id)
          return (
            <CheckCard
              key={route.id}
              className={styles.routeCard}
              checked={checked}
              disabled={!canEdit}
              onChange={() => toggleRoute(route.id)}
              title={route.name}
              note={use && !checked ? (
                <span className={styles.routeWarn}>{`いま「${use.name}」（順番${use.priority}）が動いています`}</span>
              ) : (
                <span className={styles.routeSub}>{route.kind ? `QR・URL｜${route.kind}` : 'QR・URL'}</span>
              )}
            />
          )
        })}
        {visibleRoutes.length === 0 ? (
          <p className={styles.cardDesc}>条件に合う流入リンクはありません。名前を変えて探してください。</p>
        ) : null}
        <div className={styles.routeFoot}>
          {canEdit ? (
            <Button href="/inflow-links" variant="text">
              <Plus size={15} aria-hidden="true" />流入リンクを新しく発行する
            </Button>
          ) : null}
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.countNote}>{selectedCount > 0 ? `${selectedCount}つ選んでいます` : '選んでいません'}</span>
        </div>
        {routeError ? <p className={styles.fieldError} role="alert">{routeError}</p> : null}
        <div className={styles.narrowBox} aria-label="対象をしぼる（任意）" role="group">
          <h3 className={styles.subTitle}>対象をしぼる（任意）</h3>
          <p className={styles.subDesc}>空のままなら、選んだリンクから来た全員に送ります。</p>
          <div className={styles.datePair}>
            <div className={styles.field}>
              <label htmlFor="fa-from" className={styles.label}>有効期間 はじめ</label>
              <TextField
                id="fa-from"
                type="datetime-local"
                value={localInputValue(definition.activeFrom)}
                disabled={!canEdit}
                onChange={(event) => setDefinition((current) => ({ ...current, activeFrom: event.target.value || null }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="fa-until" className={styles.label}>有効期間 おわり</label>
              <TextField
                id="fa-until"
                type="datetime-local"
                value={localInputValue(definition.activeUntil)}
                disabled={!canEdit}
                onChange={(event) => setDefinition((current) => ({ ...current, activeUntil: event.target.value || null }))}
              />
            </div>
          </div>
          {legacy ? (
            <p className={styles.fieldError} role="alert">以前の形式の条件が入っているため、今は配信を止めています。下の条件を作り直してください。</p>
          ) : null}
          <div className={styles.conditionRow}>
            <button
              type="button"
              className={styles.conditionSummary}
              aria-expanded={conditionOpen}
              onClick={() => setConditionOpen((open) => !open)}
            >
              <span className={styles.conditionText}>{conditionSummary(parsed, options.tags)}</span>
              <span aria-hidden="true" className={styles.conditionChevron}>⌄</span>
            </button>
            {canEdit ? <Button type="button" onClick={() => setConditionOpen(true)}>条件を足す</Button> : null}
          </div>
          {conditionOpen ? (
            <ConditionBuilder
              value={parsed}
              onChange={(next) => {
                if (!canEdit) return
                const pruned = pruneCondition(next)
                setDefinition((current) => ({ ...current, friendCondition: pruned ? JSON.stringify(pruned) : '' }))
              }}
              label="この初回案内を使う友だち"
              showCount={false}
            />
          ) : null}
        </div>
      </Card>
      <Notice
        tone="info"
        icon={<Route size={16} aria-hidden="true" />}
        message={rule.isFallback
          ? 'この設定は、流入経路を確定できなかった人へ最後に動きます。'
          : '基本の追加URL・素のQR・検索から来た人は、どの設定でも選べません。いちばん最後の「経路が分からなかった人」が動きます。'}
      />
    </>
  )
}

/* ===== 作る③ 初回案内（板 `al47K`・競合 `h5rm8t`） ===== */

const MESSAGE_TABS: Array<{ key: FriendAddRuleDefinition['messageType'] | 'none'; label: string; icon: typeof Pencil; enabled: boolean; reason?: string }> = [
  { key: 'text', label: 'この画面で書く', icon: Pencil, enabled: true },
  /* できていない形式は選べない形で出す（理由を title に）。 */
  { key: 'template', label: 'テンプレートから', icon: FileText, enabled: false, reason: 'テンプレートからの作成はこの版では選べません' },
  { key: 'form', label: '回答フォーム', icon: ListChecks, enabled: false, reason: '回答フォームの作成はこの版では選べません' },
  { key: 'scenario', label: 'シナリオを始める', icon: Workflow, enabled: false, reason: 'シナリオからの開始は「あわせて行うこと」で選びます' },
  { key: 'none', label: '送らない', icon: Ban, enabled: false, reason: '送らない設定は「以前からの友だち」のときに選びます' },
]

function MessageStep({ definition, setDefinition, friendKind, scenarios, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: Dispatch<SetStateAction<FriendAddRuleDefinition>>
  friendKind: FriendAddRuleKind
  scenarios: FriendAddRuleOptions['scenarios']
  canEdit: boolean
}) {
  const messageRef = useRef<HTMLTextAreaElement | null>(null)
  const insertToken = (token: string) => {
    const area = messageRef.current
    if (!area) return
    const start = area.selectionStart ?? definition.messageText.length
    const end = area.selectionEnd ?? start
    const next = definition.messageText.slice(0, start) + token + definition.messageText.slice(end)
    setDefinition((current) => ({ ...current, messageText: next }))
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + token.length, start + token.length)
    })
  }
  if (friendKind === 'returning') {
    return <ReturningMessage definition={definition} setDefinition={setDefinition} scenarios={scenarios} canEdit={canEdit} />
  }
  const scheduled = definition.timeWindows != null && definition.timeWindows.length > 0
  const suppressOn = (definition.resendSuppressionHours ?? 24) > 0
  return (
    <>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="最初に送るもの">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>最初に送るもの</h2>
        </div>
        <div className={styles.chipRow} role="group" aria-label="最初に送るものの種類">
          {MESSAGE_TABS.map((tab) => {
            const selected = definition.messageType === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={selected}
                disabled={!tab.enabled || !canEdit}
                title={tab.reason}
                className={styles.pickChip}
                data-selected={selected || undefined}
                onClick={() => { if (tab.key !== 'none') setDefinition((current) => ({ ...current, messageType: tab.key as FriendAddRuleDefinition['messageType'] })) }}
              >
                <tab.icon size={13} aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className={styles.bodyBox}>
          <textarea
            ref={messageRef}
            aria-label="最初に送るメッセージ"
            className={styles.bodyText}
            rows={2}
            maxLength={MESSAGE_LIMIT}
            value={definition.messageText}
            disabled={!canEdit}
            onChange={(event) => setDefinition((current) => ({ ...current, messageText: event.target.value }))}
          />
          <div className={styles.insertRow}>
            <span className={styles.insertLabel}>差し込む</span>
            <Button type="button" variant="text" disabled={!canEdit} onClick={() => insertToken('{{name}}')}>
              <User size={15} aria-hidden="true" />名前
            </Button>
            <Button type="button" variant="text" disabled title="友だち情報の欄を選ぶ口はこの版にありません">
              <IdCard size={15} aria-hidden="true" />友だち情報
            </Button>
            <Button type="button" variant="text" disabled title="共通情報の値を選ぶ口はこの版にありません">
              <Braces size={15} aria-hidden="true" />共通情報
            </Button>
            <span className={styles.spacer} aria-hidden="true" />
            <span className={styles.charCount}>{`${formatNumber(definition.messageText.length)} / ${formatNumber(MESSAGE_LIMIT)}`}</span>
          </div>
        </div>
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="いつ送るか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>いつ送るか</h2>
        </div>
        <div className={styles.segRow}>
          <SegmentedControl
            aria-label="送るタイミング"
            value={scheduled ? 'window' : 'now'}
            onChange={(next) => {
              if (!canEdit) return
              setDefinition((current) => next === 'now'
                ? { ...current, weekdays: [0, 1, 2, 3, 4, 5, 6], timeWindows: [] }
                : { ...current, timeWindows: current.timeWindows && current.timeWindows.length > 0 ? current.timeWindows : addTimeWindow(current.timeWindows) })
            }}
            options={[
              { value: 'now', label: '追加してすぐ' },
              { value: 'window', label: '時間帯を決める' },
            ]}
          />
        </div>
        <p className={styles.cardDesc}>「時間帯を決める」にすると、時間帯の外に追加した人には、次の時間帯の始めに届きます。</p>
        {scheduled ? (
          <div className={styles.field}>
            <span className={styles.label}>曜日</span>
            <div className={styles.weekRow}>
              {['日', '月', '火', '水', '木', '金', '土'].map((label, day) => {
                const checked = (definition.weekdays ?? []).includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`${label}曜日`}
                    disabled={!canEdit}
                    className={styles.pickChip}
                    data-selected={checked || undefined}
                    onClick={() => setDefinition((current) => {
                      const days = current.weekdays ?? []
                      return { ...current, weekdays: days.includes(day) ? days.filter((value) => value !== day) : [...days, day].sort() }
                    })}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {(definition.timeWindows ?? []).map((slot, index) => (
              <div key={index} className={styles.timeRow}>
                <TextField
                  type="time"
                  aria-label={`時間帯${index + 1}の開始`}
                  value={slot.start}
                  disabled={!canEdit}
                  onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { start: event.target.value }) }))}
                />
                <span aria-hidden="true">〜</span>
                <TextField
                  type="time"
                  aria-label={`時間帯${index + 1}の終了`}
                  value={slot.end}
                  disabled={!canEdit}
                  onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { end: event.target.value }) }))}
                />
                {canEdit ? (
                  <Button type="button" variant="text" aria-label={`時間帯${index + 1}を削除`} onClick={() => setDefinition((current) => ({ ...current, timeWindows: removeTimeWindow(current.timeWindows, index) }))}>削除</Button>
                ) : null}
              </div>
            ))}
            {canEdit ? (
              <Button type="button" variant="text" onClick={() => setDefinition((current) => ({ ...current, timeWindows: addTimeWindow(current.timeWindows) }))}>
                <Plus size={15} aria-hidden="true" />時間帯を足す
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="同じ人に何度も送らない">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>同じ人に何度も送らない</h2>
        </div>
        <div className={styles.switchRow}>
          <span className={styles.switchText}>{`同じ人へは ${resendSuppressionText(definition.resendSuppressionHours)}まで`}</span>
          <span className={styles.spacer} aria-hidden="true" />
          <Toggle
            checked={suppressOn}
            label="同じ人に何度も送らない"
            onChange={canEdit ? (next) => setDefinition((current) => ({ ...current, resendSuppressionHours: next ? 24 : 0 })) : undefined}
          />
        </div>
      </Card>
    </>
  )
}

function ReturningMessage({ definition, setDefinition, scenarios, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: Dispatch<SetStateAction<FriendAddRuleDefinition>>
  scenarios: FriendAddRuleOptions['scenarios']
  canEdit: boolean
}) {
  const mode = definition.returningMode ?? 'same'
  const start = definition.startPosition ?? 'beginning'
  return (
    <>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="追加のときに送るもの">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>追加のときに送るもの</h2>
          <p className={styles.cardDesc}>戻ってきた人に何を送るか選びます。</p>
        </div>
        <RadioCardGroup legend="追加のときに送るもの" className={styles.kindTriple}>
          {([
            { key: 'none', title: '何も送らない', desc: '案内後の操作だけを行う' },
            { key: 'same', title: 'はじめてと同じ', desc: 'はじめての人と同じ案内を送る' },
            { key: 'other', title: '別のシナリオ', desc: '選んだシナリオから始める' },
          ] as const).map((option) => (
            <RadioCard
              key={option.key}
              name="fa-returning"
              value={option.key}
              checked={mode === option.key}
              disabled={!canEdit}
              onChange={() => setDefinition((current) => ({ ...current, returningMode: option.key }))}
              title={option.title}
              note={option.desc}
            />
          ))}
        </RadioCardGroup>
        {mode === 'other' ? (
          <div className={styles.field}>
            <label htmlFor="fa-returning-scenario" className={styles.label}>始めるシナリオ</label>
            <Select
              id="fa-returning-scenario"
              aria-label="始めるシナリオ"
              size="full"
              value={definition.scenarioId ?? ''}
              disabled={!canEdit}
              onChange={(value) => setDefinition((current) => ({ ...current, scenarioId: value || null }))}
              options={[{ value: '', label: '選んでください' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
            />
          </div>
        ) : null}
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="どこから始めるか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>どこから始めるか</h2>
        </div>
        <RadioCardGroup legend="どこから始めるか" className={styles.kindPair}>
          {([
            { key: 'beginning', title: '最初から', desc: '一度も届いていない人にも最初から届きます' },
            { key: 'resume', title: '前回送った次から', desc: '途中まで届いた人へ続きを送ります' },
          ] as const).map((option) => (
            <RadioCard
              key={option.key}
              name="fa-start"
              value={option.key}
              checked={start === option.key}
              disabled={!canEdit}
              onChange={() => setDefinition((current) => ({ ...current, startPosition: option.key }))}
              title={option.title}
              note={option.desc}
            />
          ))}
        </RadioCardGroup>
      </Card>
    </>
  )
}

/* ===== 作る④ あわせて行うこと（板 `i1nThZ`） ===== */

const ACTION_KINDS: Array<{ type: FriendAddRuleAction['type']; label: string; source: 'tag' | 'scenario' }> = [
  { type: 'add_tag', label: 'タグを付ける', source: 'tag' },
  { type: 'remove_tag', label: 'タグを外す', source: 'tag' },
  { type: 'start_scenario', label: 'シナリオを始める', source: 'scenario' },
]

function ActionsStep({ definition, setDefinition, options, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: Dispatch<SetStateAction<FriendAddRuleDefinition>>
  options: FriendAddRuleOptions
  canEdit: boolean
}) {
  const [kind, setKind] = useState<FriendAddRuleAction['type']>('add_tag')
  const [target, setTarget] = useState('')
  const source = ACTION_KINDS.find((item) => item.type === kind)?.source ?? 'tag'
  const targets = source === 'scenario' ? options.scenarios : options.tags
  const addAction = () => {
    const found = targets.find((item) => item.id === target)
    if (!found) return
    const label = kind === 'start_scenario'
      ? `シナリオ「${found.name}」を始める`
      : kind === 'remove_tag'
        ? `タグ「${found.name}」を外す`
        : `タグ「${found.name}」を付ける`
    setDefinition((current) => ({ ...current, actions: [...current.actions, { type: kind, label, targetId: found.id }] }))
    setTarget('')
  }
  return (
    <Card padding="roomy" layout="vertical" className={styles.card} aria-label="あわせて行うこと">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>あわせて行うこと</h2>
        <p className={styles.cardDesc}>案内を送ったあと、上から順に行います</p>
      </div>
      {definition.actions.length === 0 ? (
        <p className={styles.cardDesc}>まだ何もありません。下から足せます。</p>
      ) : (
        <ol className={styles.actionList}>
          {definition.actions.map((action, index) => (
            <li key={`${action.type}-${index}`} className={styles.actionRow}>
              <span className={styles.actionIndex}>{index + 1}</span>
              <span className={styles.actionLabel} title={action.label}>{action.label}</span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="text"
                  aria-label={`${action.label}を外す`}
                  onClick={() => setDefinition((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))}
                >
                  外す
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canEdit ? (
        <div className={styles.actionAdd}>
          <div className={styles.actionSelect}>
            <Select
              aria-label="足す操作の種類"
              size="full"
              value={kind}
              onChange={(value) => { setKind(value as FriendAddRuleAction['type']); setTarget('') }}
              options={ACTION_KINDS.map((item) => ({ value: item.type, label: item.label }))}
            />
          </div>
          <div className={styles.actionSelect}>
            <Select
              aria-label="足す操作の対象"
              size="full"
              value={target}
              onChange={setTarget}
              options={[{ value: '', label: '選んでください' }, ...targets.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </div>
          <Button type="button" disabled={!target} onClick={addAction}>
            <Plus size={15} aria-hidden="true" />足す
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

/* ===== 作る⑤ 確認（板 `U8Xm3X`） ===== */

function PreviewStep({ rule, definition, routeNames, runTest, testing, testOk, overlapNotes, slackConnected, canEdit, hrefFor }: {
  rule: EditorRule
  definition: FriendAddRuleDefinition
  routeNames: string[]
  runTest: () => void
  testing: boolean
  testOk: boolean
  overlapNotes: string[]
  slackConnected: boolean | null
  canEdit: boolean
  hrefFor: (next: Step, extra?: string) => string
}) {
  const noneMode = rule.friendKind === 'returning' && definition.returningMode === 'none'
  const firstSend = noneMode
    ? '配信なし'
    : definition.messageType === 'text' && definition.messageText
      ? `テキスト ${definition.messageText.length}字`
      : MESSAGE_TYPE_LABEL[definition.messageType] ?? '未設定'
  const actionSummary = definition.actions.length === 0
    ? 'なし'
    : `${definition.actions.slice(0, 2).map((action) => action.label.replace(/「.*」/, '')).join('・')}の${definition.actions.length}つ`
  const overlapOk = overlapNotes.length === 0
  const rows: Array<{ label: string; value: string; href: string }> = [
    { label: '名前・フォルダ', value: `${rule.name || '（未入力）'}${rule.folderName ? `・${rule.folderName}` : ''}`, href: hrefFor('basic') },
    { label: 'だれに', value: rule.friendKind === 'returning' ? '以前からの友だち・ブロック解除した人' : 'はじめて友だち追加した人', href: hrefFor('basic') },
    { label: '流入リンク', value: routeNames.length > 0 ? routeNames.join('・') : '未選択', href: hrefFor('routes') },
    { label: '最初に送るもの', value: `${firstSend}${definition.timing === 'immediate' ? '・追加してすぐ' : ''}`, href: hrefFor('message') },
    { label: 'あわせて行うこと', value: actionSummary, href: hrefFor('actions') },
    { label: '順番', value: `${rule.priority}番目（「経路が分からなかった人」の前）`, href: '/friend-add-settings' },
  ]
  const checks = [
    { ok: overlapOk, title: '流入リンクの重なりがない', desc: overlapOk ? `選んだ${definition.routeIds.length}つは、ほかの設定で使われていません` : overlapNotes[0], href: hrefFor('routes') },
    { ok: true, title: '二重送信を防ぐ', desc: `同じ人へは${resendSuppressionText(definition.resendSuppressionHours)}まで`, href: hrefFor('message') },
    { ok: testOk, title: 'テストで判定を確かめた', desc: testOk ? 'テストで判定が通りました' : 'テストで判定が通るまで、有効にはできません', href: null },
    { ok: slackConnected !== false, title: '失敗をSlackへ知らせる', desc: `未送信・二重送信・シナリオ開始失敗を知らせます${slackConnected === true ? '（接続済み）' : slackConnected === false ? '（未接続）' : ''}`, href: '/line-notifications/operator/new' },
  ]
  return (
    <>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="設定の確認">
        <div className={styles.cardHead}><h2 className={styles.cardTitle}>設定の確認</h2></div>
        <dl className={styles.confirmRows}>
          {rows.map((row) => (
            <div key={row.label} className={styles.confirmRow}>
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
              <dd>{canEdit ? <Link className={styles.textLink} href={row.href}>変える</Link> : null}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="テストする（送らずに判定）">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>テストする（送らずに判定）</h2>
          <p className={styles.cardDesc}>本番の登録・タグ・マイルは変えません</p>
        </div>
        <div className={styles.switchRow}>
          <span className={styles.switchText}>送り先：自分（送らずに判定）</span>
          <span className={styles.spacer} aria-hidden="true" />
          {canEdit ? (
            <Button type="button" disabled={testing} busy={testing} busyLabel="判定中…" onClick={runTest}>テストする（送らずに判定）</Button>
          ) : null}
        </div>
        <p className={styles.cardDesc}>{testOk ? 'テストで判定が通りました。' : 'まだテストしていません'}</p>
      </Card>
      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="有効にする前の確認">
        <div className={styles.cardHead}><h2 className={styles.cardTitle}>有効にする前の確認</h2></div>
        <ul className={styles.checkList}>
          {checks.map((check) => (
            <li key={check.title} className={styles.checkRow}>
              <span className={styles.checkMark} data-ok={check.ok || undefined} aria-hidden="true">
                {check.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
              </span>
              <span className={styles.checkText}>
                <strong>{check.title}</strong>
                <small>{check.desc}</small>
              </span>
              {canEdit ? (
                check.href
                  ? <Link className={styles.textLink} href={check.href}>見直す</Link>
                  : <Button type="button" variant="text" disabled={testing} onClick={runTest}>直す</Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
