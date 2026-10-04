'use client'

/*
 * ★V8 友だち追加時の配信を作る・直す（Pencil「★V8 画面の地図」の行：
 * 作る①基本設定 `wDzkc` → ②流入リンク `h8uNW` → ③初回案内 `al47K` →
 * ④あわせて行うこと `i1nThZ` → ⑤確認 `U8Xm3X`）。
 *
 * v7 の編集器（friend-add-rule-editor.tsx）とは別の部品として持つ。
 * 読み・保存・テスト・離脱の番兵は同じ（口・版・下書き・冪等の鍵・
 * 競合の扱いを変えない）。違いは置き場と見せ方——手順の輪・右の
 * 「設定内容」・届くメッセージを決める手順からのスマホの見え方・
 * 下に追従する帯（キャンセル・下書きを保存・次へ）。
 * v7 を直す必要が出たら v7 の編集器側も同じ判断を入れる。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  Link2,
  Pencil,
  Power,
  Search,
  UserPlus,
  Users,
} from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConditionBuilder from '@/components/shared/condition-builder'
import ListState from '@/components/shared/list-state'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import type { SegmentCondition } from '@/lib/segment-condition'
import { pruneCondition } from '@/lib/segment-condition'
import { api, describeSaveFailure } from '@/lib/api'
import type {
  FriendAddRuleAction,
  FriendAddRuleDefinition,
  FriendAddRuleKind,
  FriendAddRuleOptions,
} from '@/lib/api'
import { describeFriendAddFailure } from './friend-add-failure'
import {
  addTimeWindow,
  MESSAGE_TYPE_LABEL,
  removeTimeWindow,
  updateTimeWindow,
} from './friend-add-flow'
import { resendSuppressionText } from './friend-add-text'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './editor-v8.module.css'

type Step = 'basic' | 'routes' | 'message' | 'actions' | 'preview'
/** 確認段のテストに渡す試行条件（要件 4-5 の入力）。 */
type TestInput = { routeId: string; expectedAt: string; friendId: string; friendName: string }
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
/* 手順の輪の文言は板どおり（v7 の「流入条件」「アクション」とは呼ばない）。 */
const STEPS: Array<{ key: Step; order: number; label: string; node: string }> = [
  { key: 'basic', order: 1, label: '基本設定', node: 'wDzkc' },
  { key: 'routes', order: 2, label: '流入リンク', node: 'h8uNW' },
  { key: 'message', order: 3, label: '初回案内', node: 'al47K' },
  { key: 'actions', order: 4, label: 'あわせて行うこと', node: 'i1nThZ' },
  { key: 'preview', order: 5, label: '確認', node: 'U8Xm3X' },
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

export default function FriendAddEditorV8({ ruleId }: { ruleId?: string }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddEditorV8Inner ruleId={ruleId} />
    </Suspense>
  )
}

function FriendAddEditorV8Inner({ ruleId }: { ruleId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const readonlyReason = 'この操作にはオーナーか管理者の権限が要ります'
  const requestedStep = searchParams.get('step') as Step | null
  const step: Step = STEPS.some((item) => item.key === requestedStep) ? requestedStep! : 'basic'
  usePageTitle('初回案内を作る')
  const [rule, setRule] = useState<EditorRule>({
    name: '', folderName: null, priority: 1, friendKind: 'first_time', isFallback: false,
    status: 'draft', matchedLast7Days: null, lastTestStatus: null, version: 0,
  })
  const [definition, setDefinition] = useState<FriendAddRuleDefinition>(EMPTY_DEFINITION)
  const [options, setOptions] = useState<FriendAddRuleOptions>({ routes: [], scenarios: [], tags: [], folders: [] })
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null)
  const [validateChecks, setValidateChecks] = useState<Array<{ key: string; status: string; detail: string }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testResult, setTestResult] = useState<{
    accountId: string
    ruleId: string
    snapshot: string
    matched: boolean
    reasons: string[]
    stateChanged: false
  } | null>(null)
  const [testInput] = useState<TestInput>({ routeId: '', expectedAt: '', friendId: '', friendName: '' })
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
      if (ruleId) {
        const response = await api.friendAddRules.get(request.accountId, ruleId)
        if (!isCurrentRequest()) return
        if (!response.success) { setError(response.error); return }
        const loadedRule: EditorRule = {
          name: response.data.rule.name,
          folderName: response.data.rule.folderName,
          priority: response.data.rule.priority,
          friendKind: response.data.rule.friendKind,
          isFallback: response.data.rule.isFallback,
          status: response.data.rule.status,
          matchedLast7Days: response.data.rule.matchedLast7Days,
          lastTestStatus: response.data.rule.lastTestStatus,
          version: response.data.rule.version,
        }
        setRule(loadedRule)
        setDefinition(response.data.rule.definition)
        savedSnapshot.current = editorSnapshot(loadedRule, response.data.rule.definition)
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        setSlackConnected(response.data.staffNotification?.status === 'connected' ? true : response.data.staffNotification?.status == null ? null : false)
        setLoadedAccountId(request.accountId)
      } else {
        const response = await api.friendAddRules.list(request.accountId, 'first_time')
        if (!isCurrentRequest()) return
        if (!response.success) { setError(response.error); return }
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        const conflictRes = await api.friendAddRules.conflicts(request.accountId, 'first_time')
        if (!isCurrentRequest()) return
        const fallbackIds = new Set(response.data.items.filter((item) => item.isFallback).map((item) => item.id))
        const maxPriority = conflictRes.success
          ? conflictRes.data.rules.reduce((max, item) => (fallbackIds.has(item.id) ? max : Math.max(max, item.priority)), 0)
          : response.data.items.filter((item) => !item.isFallback).length
        setRule((current) => {
          const initialRule = { ...current, priority: Math.max(1, maxPriority + 1) }
          savedSnapshot.current = editorSnapshot(initialRule, EMPTY_DEFINITION)
          return initialRule
        })
        setLoadedAccountId(request.accountId)
      }
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

  /* 未保存の変更がある間、画面外への離脱を確認対話へ寄せる（DETAIL-04系）。 */
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
      setNotice('下書きを保存しました。')
      if (!ruleId || nextStep) router.replace(`/friend-add-settings?view=edit&id=${encodeURIComponent(savedId)}&step=${nextStep ?? step}`)
      return savedId
    } catch (error) {
      setError(describeSaveFailure(error))
      return null
    } finally {
      saveInFlight.current = false
      setSaving(false)
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
      const response = await api.friendAddRules.test(selectedAccountId, activeId, {
        routeId: testInput.routeId || null,
        expectedAt: testInput.expectedAt || null,
        friendId: testInput.friendId || null,
      })
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
        setOverlapNotes(res.data.conflicts.map((conflict) => conflict.message))
      } catch {
        /* 読めないときは重なりの行を出さない。 */
      }
    })()
    return () => { alive = false }
  }, [step, selectedAccountId, rule.friendKind])

  /* 板 `U8Xm3X` の「有効にする」：検証が通り、テストで判定が通ったときだけ押せる。 */
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

  if (accountLoading || loading) return <ListState kind="loading" title="設定を読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで対象を選ぶと設定を表示します。' : '先にLINE公式アカウントを登録してください。'} />
  if (loadedAccountId !== selectedAccountId) {
    return error
      ? <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />
      : <ListState kind="loading" title="設定を読み込んでいます" />
  }
  if (error && !rule.name && ruleId) return <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />

  const node = STEPS[currentIndex].node
  const nextLabel = step === 'preview' ? '' : STEPS[Math.min(currentIndex + 1, 4)].label
  return (
    <div className={styles.board} data-design-node={node}>
      <a className={styles.backLink} href="/friend-add-settings">← 友だち追加時の配信へ</a>
      <h2 className={styles.title}>初回案内を作る</h2>
      <nav className={styles.steps} aria-label="初回案内の作る手順">
        {STEPS.map((item, index) => (
          <span key={item.key} className={styles.stepWrap}>
            <button
              type="button"
              className={index < currentIndex ? styles.stepDone : item.key === step ? styles.stepCurrent : styles.stepTodo}
              aria-current={item.key === step ? 'step' : undefined}
              onClick={() => moveToStep(item.key)}
            >
              <span className={styles.stepMark}>{index < currentIndex ? <Check size={13} aria-hidden="true" /> : item.order}</span>
              {item.label}
            </button>
            {index < STEPS.length - 1 ? <span className={styles.stepLine} aria-hidden="true" /> : null}
          </span>
        ))}
      </nav>
      <p className={styles.stepNote}>
        {step === 'basic'
          ? 'いまは下書きとして作ります。最後の「確認」で有効にします。'
          : `名前：${rule.name || '（未入力）'}・いまは下書きです`}
      </p>
      {error ? <p className={styles.errorBand} role="alert">{error}</p> : null}
      {notice ? <p className={styles.noticeBand} role="status">{notice}</p> : null}
      {!canEdit ? (
        <p className={styles.readonlyBand} role="note">
          <Eye size={14} aria-hidden="true" />
          閲覧のみで見ています。変える操作は管理者に頼んでください。
        </p>
      ) : null}
      <div className={styles.split}>
        <div className={styles.main}>
          {step === 'basic' ? (
            <BasicStepV8
              rule={rule}
              setRule={setRule}
              options={options}
              canEdit={canEdit}
              readonlyReason={readonlyReason}
              isExisting={Boolean(ruleId)}
              nameError={fieldError?.step === 'basic' ? fieldError.message : undefined}
            />
          ) : null}
          {step === 'routes' ? (
            <RoutesStepV8
              rule={rule}
              definition={definition}
              setDefinition={setDefinition}
              options={options}
              toggleRoute={toggleRoute}
              canEdit={canEdit}
              routeError={fieldError?.step === 'routes' ? fieldError.message : undefined}
            />
          ) : null}
          {step === 'message' ? (
            <MessageStepV8
              definition={definition}
              setDefinition={setDefinition}
              friendKind={rule.friendKind}
              scenarios={options.scenarios}
              canEdit={canEdit}
            />
          ) : null}
          {step === 'actions' ? (
            <ActionsStepV8
              definition={definition}
              setDefinition={setDefinition}
              options={options}
              canEdit={canEdit}
            />
          ) : null}
          {step === 'preview' ? (
            <PreviewStepV8
              rule={rule}
              definition={definition}
              options={options}
              runTest={runTest}
              testing={saving}
              testOk={Boolean(testOk)}
              overlapNotes={overlapNotes}
              slackConnected={slackConnected}
              canEdit={canEdit}
              hrefFor={hrefFor}
            />
          ) : null}
        </div>
        <EditorSummaryV8 step={step} rule={rule} definition={definition} options={options} />
      </div>
      <div className={styles.bottomBar}>
        <div className={styles.bottomActions}>
          <Button href="/friend-add-settings" variant="secondary">キャンセル</Button>
          <Button type="button" variant="secondary" disabled={!canEdit || saving || enabling} title={!canEdit ? readonlyReason : undefined} onClick={() => void save()}>下書きのまま保存</Button>
          {step === 'preview' ? (
            <Button
              type="button"
              variant="primary"
              disabled={!canEnable}
              title={!canEdit ? readonlyReason : !testOk ? 'テストで判定が通るまで、有効にはできません' : !overlapOk ? '確認の直しを終えてから有効にできます' : undefined}
              busy={enabling}
              busyLabel="有効化中…"
              onClick={() => void enableRule()}
            >
              <Power size={14} aria-hidden="true" />
              有効にする
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled={saving || enabling} onClick={() => moveToStep(STEPS[Math.min(currentIndex + 1, 4)].key)}>
              次へ：{nextLabel}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="追加時の動きへの変更"
        busy={saving || enabling}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

/* ===== 作る① 基本設定（板 `wDzkc`） ===== */

function BasicStepV8({ rule, setRule, options, canEdit, readonlyReason, isExisting, nameError }: {
  rule: EditorRule
  setRule: React.Dispatch<React.SetStateAction<EditorRule>>
  options: FriendAddRuleOptions
  canEdit: boolean
  readonlyReason: string
  isExisting: boolean
  nameError?: string
}) {
  const locked = rule.isFallback || isExisting
  const folderOptions = options.folders.some((folder) => folder.name === (rule.folderName ?? ''))
    ? options.folders
    : rule.folderName ? [...options.folders, { id: rule.folderName, name: rule.folderName }] : options.folders
  return (
    <>
      <section className={styles.card} aria-label="名前とフォルダ">
        <h3 className={styles.cardTitle}>名前とフォルダ</h3>
        <p className={styles.cardDesc}>一覧に出る名前です。友だちには見えません。</p>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>設定名（60文字まで）</span>
            <input
              className={styles.input}
              value={rule.name}
              maxLength={60}
              disabled={!canEdit}
              title={!canEdit ? readonlyReason : undefined}
              onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))}
            />
            {nameError ? <span className={styles.fieldError} role="alert">{nameError}</span> : null}
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>フォルダ</span>
            <span className={styles.selectWrap}>
              <select
                className={styles.input}
                value={rule.folderName ?? ''}
                disabled={!canEdit}
                title={!canEdit ? readonlyReason : undefined}
                onChange={(event) => setRule((current) => ({ ...current, folderName: event.target.value || null }))}
              >
                <option value="">未分類</option>
                {folderOptions.map((folder) => (
                  <option key={folder.id} value={folder.name}>{folder.name}</option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" className={styles.selectIcon} />
            </span>
          </label>
        </div>
      </section>
      <section className={styles.card} aria-label="だれに送るか">
        <h3 className={styles.cardTitle}>だれに送るか</h3>
        <p className={styles.cardDesc}>保存したあとは変えられません</p>
        <div className={styles.pickRow} role="radiogroup" aria-label="だれに送るか">
          <button
            type="button"
            role="radio"
            aria-checked={rule.friendKind === 'first_time'}
            disabled={!canEdit || locked}
            title={!canEdit ? readonlyReason : locked ? '保存したあとの設定では変えられません' : undefined}
            className={rule.friendKind === 'first_time' ? styles.pickActive : styles.pick}
            onClick={() => setRule((current) => ({ ...current, friendKind: 'first_time' }))}
          >
            <span className={styles.pickRadio} aria-hidden="true" />
            <UserPlus size={16} aria-hidden="true" />
            <strong>はじめて友だち追加した人</strong>
            <small>初めての人にだけ「はじめまして」</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={rule.friendKind === 'returning'}
            disabled={!canEdit || locked}
            title={!canEdit ? readonlyReason : locked ? '保存したあとの設定では変えられません' : undefined}
            className={rule.friendKind === 'returning' ? styles.pickActive : styles.pick}
            onClick={() => setRule((current) => ({ ...current, friendKind: 'returning' }))}
          >
            <span className={styles.pickRadio} aria-hidden="true" />
            <Users size={16} aria-hidden="true" />
            <strong>以前からの友だち・ブロック解除した人</strong>
            <small>戻ってきた人には別の案内</small>
          </button>
        </div>
        <p className={styles.infoBand}>
          <CircleAlert size={14} aria-hidden="true" />
          この2つを分けないと、以前からのお客さまに「はじめまして」が届きます。
        </p>
      </section>
    </>
  )
}

/* ===== 作る② 流入リンク（板 `h8uNW`） ===== */

function RoutesStepV8({ rule, definition, setDefinition, options, toggleRoute, canEdit, routeError }: {
  rule: EditorRule
  definition: FriendAddRuleDefinition
  setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>
  options: FriendAddRuleOptions
  toggleRoute: (id: string) => void
  canEdit: boolean
  routeError?: string
}) {
  const [query, setQuery] = useState('')
  const keyword = query.trim()
  const visibleRoutes = keyword
    ? options.routes.filter((route) => route.name.includes(keyword))
    : options.routes
  const selectedCount = definition.routeIds.length
  return (
    <>
      <section className={styles.card} aria-label="どの流入リンクから来た人に送るか">
        <h3 className={styles.cardTitle}>どの流入リンクから来た人に送るか</h3>
        <p className={styles.cardDesc}>選んだリンクの URL・QR（どちらも同じ入口）から追加された人に動きます</p>
        <label className={styles.searchBox}>
          <Search size={14} aria-hidden="true" />
          <input
            className={styles.searchInput}
            value={query}
            placeholder="流入リンクの名前で探す"
            aria-label="流入リンクの名前で探す"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ul className={styles.routeList}>
          {visibleRoutes.map((route) => {
            const checked = definition.routeIds.includes(route.id)
            return (
              <li key={route.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={!canEdit}
                  title={!canEdit ? 'この操作にはオーナーか管理者の権限が要ります' : undefined}
                  className={checked ? styles.routeActive : styles.route}
                  onClick={() => toggleRoute(route.id)}
                >
                  <span className={styles.routeCheck} aria-hidden="true">
                    {checked ? <Check size={13} /> : null}
                  </span>
                  <span className={styles.routeText}>
                    <strong>{route.name}</strong>
                    <small>{route.kind ? `QR・URL（${route.kind}）` : 'QR・URL'}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {visibleRoutes.length === 0 ? (
          <p className={styles.cardDesc}>条件に合う流入リンクはありません。名前を変えて探してください。</p>
        ) : null}
        <div className={styles.routeFoot}>
          <a className={styles.textLink} href="/inflow-links">＋ 流入リンクを新しく発行する</a>
          <span className={styles.countNote}>{selectedCount > 0 ? `${selectedCount}つ選んでいます` : '選んでいません'}</span>
        </div>
        {routeError ? <p className={styles.fieldError} role="alert">{routeError}</p> : null}
      </section>
      <section className={styles.card} aria-label="対象をしぼる（任意）">
        <h3 className={styles.cardTitle}>対象をしぼる（任意）</h3>
        <p className={styles.cardDesc}>空のままなら、選んだリンクから来た全員に送ります。</p>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>有効期間 はじめ</span>
            <input
              className={styles.input}
              type="datetime-local"
              value={definition.activeFrom ?? ''}
              disabled={!canEdit}
              onChange={(event) => setDefinition((current) => ({ ...current, activeFrom: event.target.value || null }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>有効期間 おわり</span>
            <input
              className={styles.input}
              type="datetime-local"
              value={definition.activeUntil ?? ''}
              disabled={!canEdit}
              onChange={(event) => setDefinition((current) => ({ ...current, activeUntil: event.target.value || null }))}
            />
          </label>
        </div>
        <FriendConditionV8 definition={definition} setDefinition={setDefinition} canEdit={canEdit} />
      </section>
      <p className={styles.infoBand}>
        <Link2 size={14} aria-hidden="true" />
        基本の追加URL・素のQR・検索から来た人は、どの設定でも選べません。いちばん最後の「経路が分からなかった人」が動きます。
      </p>
      {rule.isFallback ? (
        <p className={styles.infoBand}>この設定は、流入経路を確定できなかった人へ最後に動きます。</p>
      ) : null}
    </>
  )
}

function FriendConditionV8({ definition, setDefinition, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>
  canEdit: boolean
}) {
  const raw = definition.friendCondition ?? ''
  const parsed = parseFriendConditionJson(raw)
  const legacy = raw.trim() !== '' && parsed === null
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>友だち条件</span>
      {legacy ? (
        <p className={styles.fieldError} role="alert">以前の形式の条件が入っているため、今は配信を止めています。下の条件を作り直してください。</p>
      ) : null}
      <ConditionBuilder
        value={parsed}
        onChange={(next) => {
          const pruned = pruneCondition(next)
          setDefinition((current) => ({ ...current, friendCondition: pruned ? JSON.stringify(pruned) : '' }))
        }}
        label="この初回案内を使う友だち"
        showCount={false}
      />
      {!canEdit ? <small className={styles.cardDesc}>閲覧のみのため変えられません。</small> : null}
    </div>
  )
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

/* ===== 作る③ 初回案内（板 `al47K`） ===== */

const MESSAGE_TABS: Array<{ key: FriendAddRuleDefinition['messageType']; label: string; enabled: boolean; reason?: string }> = [
  { key: 'text', label: 'この画面で書く', enabled: true },
  /* R202: できていない形式は選べる形で出さない。見本の札は押せない形で残す。 */
  { key: 'template', label: 'テンプレートから', enabled: false, reason: 'テンプレートからの作成はこの版では選べません' },
  { key: 'form', label: '回答フォーム', enabled: false, reason: '回答フォームの作成はこの版では選べません' },
  { key: 'scenario', label: 'シナリオを始める', enabled: false, reason: 'シナリオからの開始はあわせて行うことで選びます' },
]

function MessageStepV8({ definition, setDefinition, friendKind, scenarios, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>
  friendKind: FriendAddRuleKind
  scenarios: FriendAddRuleOptions['scenarios']
  canEdit: boolean
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const insertToken = (token: string) => {
    const area = messageRef.current
    if (!area || !canEdit) return
    const start = area.selectionStart ?? definition.messageText.length
    const end = area.selectionEnd ?? start
    const next = `${definition.messageText.slice(0, start)}${token}${definition.messageText.slice(end)}`
    setDefinition((current) => ({ ...current, messageText: next }))
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + token.length, start + token.length)
    })
  }
  /*
   * kFz4b：「以前からの友だち」のタブでは作る③が切り替わる。
   * 何を送るか（送らない／はじめてと同じ／別のシナリオ）と
   * どこから始めるか（最初から／前回送った次から）。
   */
  if (friendKind === 'returning') {
    return <ReturningMessageV8 definition={definition} setDefinition={setDefinition} scenarios={scenarios} canEdit={canEdit} />
  }
  const scheduled = definition.timeWindows != null && definition.timeWindows.length > 0
  const suppressOn = (definition.resendSuppressionHours ?? 24) > 0
  return (
    <>
      <section className={styles.card} aria-label="最初に送るもの">
        <h3 className={styles.cardTitle}>最初に送るもの</h3>
        <div className={styles.chipRow} role="group" aria-label="最初に送るものの種類">
          {MESSAGE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={definition.messageType === tab.key}
              disabled={!tab.enabled || !canEdit}
              title={!canEdit ? 'この操作にはオーナーか管理者の権限が要ります' : tab.reason}
              className={definition.messageType === tab.key ? styles.chipActive : styles.chip}
              onClick={() => setDefinition((current) => ({ ...current, messageType: tab.key }))}
            >
              {tab.key === 'text' ? <Pencil size={13} aria-hidden="true" /> : null}
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={false}
            disabled
            title="送らない設定は「以前からの友だち」のときに選びます"
            className={styles.chip}
          >
            送らない
          </button>
        </div>
        <label className={styles.field}>
          <textarea
            ref={messageRef}
            className={styles.textarea}
            rows={5}
            value={definition.messageText}
            disabled={!canEdit}
            onChange={(event) => setDefinition((current) => ({ ...current, messageText: event.target.value }))}
          />
        </label>
        <div className={styles.insertRow}>
          <span className={styles.insertLabel}>差し込む</span>
          <button type="button" className={styles.insertButton} disabled={!canEdit} onClick={() => insertToken('{{name}}')}>
            <Users size={12} aria-hidden="true" />
            名前
          </button>
          <button
            type="button"
            className={styles.insertButton}
            disabled
            title="友だち情報の欄の鍵を選ぶ口はこの版にありません"
          >
            友だち情報
          </button>
          <button
            type="button"
            className={styles.insertButton}
            disabled
            title="共通情報の値を選ぶ口はこの版にありません"
          >
            共通情報
          </button>
          <span className={styles.countNote}>{definition.messageText.length}文字</span>
        </div>
      </section>
      <section className={styles.card} aria-label="いつ送るか">
        <h3 className={styles.cardTitle}>いつ送るか</h3>
        <div className={styles.chipRow} role="group" aria-label="送るタイミング">
          <button
            type="button"
            aria-pressed={!scheduled}
            disabled={!canEdit}
            className={!scheduled ? styles.chipActive : styles.chip}
            onClick={() => setDefinition((current) => ({ ...current, weekdays: [0, 1, 2, 3, 4, 5, 6], timeWindows: [] }))}
          >
            追加してすぐ
          </button>
          <button
            type="button"
            aria-pressed={scheduled}
            disabled={!canEdit}
            className={scheduled ? styles.chipActive : styles.chip}
            onClick={() => setDefinition((current) => ({
              ...current,
              timeWindows: current.timeWindows && current.timeWindows.length > 0 ? current.timeWindows : addTimeWindow(current.timeWindows),
            }))}
          >
            時間帯を決める
          </button>
        </div>
        <p className={styles.cardDesc}>「時間帯を決める」にすると、時間帯外に追加した人には、次の時間帯の始めに届きます。</p>
        {scheduled ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>曜日</span>
            <div className={styles.weekRow}>
              {['日', '月', '火', '水', '木', '金', '土'].map((label, day) => {
                const weekdays = definition.weekdays ?? []
                const checked = weekdays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`${label}曜日`}
                    disabled={!canEdit}
                    className={checked ? styles.weekActive : styles.week}
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
                <input
                  className={styles.input}
                  type="time"
                  aria-label={`時間帯${index + 1}の開始`}
                  value={slot.start}
                  disabled={!canEdit}
                  onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { start: event.target.value }) }))}
                />
                <span aria-hidden="true">〜</span>
                <input
                  className={styles.input}
                  type="time"
                  aria-label={`時間帯${index + 1}の終了`}
                  value={slot.end}
                  disabled={!canEdit}
                  onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { end: event.target.value }) }))}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`時間帯${index + 1}を削除`}
                  disabled={!canEdit}
                  onClick={() => setDefinition((current) => ({ ...current, timeWindows: removeTimeWindow(current.timeWindows, index) }))}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.textLink}
              disabled={!canEdit}
              onClick={() => setDefinition((current) => ({ ...current, timeWindows: addTimeWindow(current.timeWindows) }))}
            >
              ＋ 時間帯を追加する
            </button>
          </div>
        ) : null}
      </section>
      <section className={styles.card} aria-label="同じ人に何度も送らない">
        <h3 className={styles.cardTitle}>同じ人に何度も送らない</h3>
        <div className={styles.switchRow}>
          <span className={styles.switchText}>同じ人へは{resendSuppressionText(definition.resendSuppressionHours)}まで</span>
          <button
            type="button"
            role="switch"
            aria-checked={suppressOn}
            aria-label="同じ人に何度も送らない"
            disabled={!canEdit}
            className={suppressOn ? styles.switchOn : styles.switch}
            onClick={() => setDefinition((current) => ({ ...current, resendSuppressionHours: suppressOn ? 0 : 24 }))}
          >
            <span className={styles.switchKnob} aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  )
}

function ReturningMessageV8({ definition, setDefinition, scenarios, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>
  scenarios: FriendAddRuleOptions['scenarios']
  canEdit: boolean
}) {
  const mode = definition.returningMode ?? 'same'
  return (
    <>
      <section className={styles.card} aria-label="追加のときに送るもの">
        <h3 className={styles.cardTitle}>追加のときに送るもの</h3>
        <p className={styles.cardDesc}>戻ってきた人に何を送るか選びます。</p>
        <div className={styles.pickRow} role="radiogroup" aria-label="追加のときに送るもの">
          {([
            { key: 'none', title: '何も送らない', desc: '案内後の操作だけを行う' },
            { key: 'same', title: 'はじめてと同じ', desc: 'はじめての人と同じ案内を送る' },
            { key: 'other', title: '別のシナリオ', desc: '選んだシナリオから始める' },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={mode === option.key}
              disabled={!canEdit}
              className={mode === option.key ? styles.pickActive : styles.pick}
              onClick={() => setDefinition((current) => ({ ...current, returningMode: option.key }))}
            >
              <span className={styles.pickRadio} aria-hidden="true" />
              <strong>{option.title}</strong>
              <small>{option.desc}</small>
            </button>
          ))}
        </div>
        {mode === 'other' ? (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>始めるシナリオ</span>
            <span className={styles.selectWrap}>
              <select
                className={styles.input}
                value={definition.scenarioId ?? ''}
                disabled={!canEdit}
                onChange={(event) => setDefinition((current) => ({ ...current, scenarioId: event.target.value || null }))}
              >
                <option value="">選んでください</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" className={styles.selectIcon} />
            </span>
          </label>
        ) : null}
      </section>
      <section className={styles.card} aria-label="どこから始めるか">
        <h3 className={styles.cardTitle}>どこから始めるか</h3>
        <div className={styles.pickRow} role="radiogroup" aria-label="どこから始めるか">
          {([
            { key: 'beginning', title: '最初から', desc: '一度も届いていない人にも最初から届きます' },
            { key: 'resume', title: '前回送った次から', desc: '途中まで届いた人へ続きを送ります' },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={(definition.startPosition ?? 'beginning') === option.key}
              disabled={!canEdit}
              className={(definition.startPosition ?? 'beginning') === option.key ? styles.pickActive : styles.pick}
              onClick={() => setDefinition((current) => ({ ...current, startPosition: option.key }))}
            >
              <span className={styles.pickRadio} aria-hidden="true" />
              <strong>{option.title}</strong>
              <small>{option.desc}</small>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

/* ===== 作る④ あわせて行うこと（板 `i1nThZ`） ===== */

const ACTION_BUTTONS: Array<{ type: FriendAddRuleAction['type']; label: string; enabled: boolean; reason?: string }> = [
  { type: 'add_tag', label: 'タグ', enabled: true },
  /* 型が3つしかないため、札だけ出して押せない形にするもの。 */
  { type: 'add_tag', label: '友だち情報', enabled: false, reason: '友だち情報の操作はこの版では選べません' },
  { type: 'start_scenario', label: 'シナリオ', enabled: true },
  { type: 'add_tag', label: '対応マーク', enabled: false, reason: '対応マークの操作はこの版では選べません' },
  { type: 'add_tag', label: 'マイル', enabled: false, reason: 'マイルの操作はこの版では選べません' },
  { type: 'add_tag', label: '共通情報', enabled: false, reason: '共通情報の操作はこの版では選べません' },
]

function ActionsStepV8({ definition, setDefinition, options, canEdit }: {
  definition: FriendAddRuleDefinition
  setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>
  options: FriendAddRuleOptions
  canEdit: boolean
}) {
  const [draftTarget, setDraftTarget] = useState('')
  return (
    <>
      <section className={styles.card} aria-label="あわせて行うこと">
        <h3 className={styles.cardTitle}>あわせて行うこと</h3>
        <p className={styles.cardDesc}>案内を送ったあと、上から順に行います</p>
        <ol className={styles.actionList}>
          {definition.actions.map((action, index) => (
            <li key={`${action.type}-${index}`} className={styles.actionRow}>
              <span className={styles.actionGrip} aria-hidden="true">⠿</span>
              <span className={styles.actionIndex}>{index + 1}</span>
              <span className={styles.actionLabel}>{action.label}</span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`${action.label}を外す`}
                disabled={!canEdit}
                onClick={() => setDefinition((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))}
              >
                …
              </button>
            </li>
          ))}
        </ol>
        {definition.actions.length === 0 ? (
          <p className={styles.cardDesc}>まだ何もありません。下から足せます。</p>
        ) : null}
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>足す操作の対象</span>
            <span className={styles.selectWrap}>
              <select
                className={styles.input}
                value={draftTarget}
                disabled={!canEdit}
                onChange={(event) => setDraftTarget(event.target.value)}
              >
                <option value="">選んでください</option>
                <optgroup label="タグ">
                  {options.tags.map((item) => (
                    <option key={`tag-${item.id}`} value={`tag:${item.id}`}>{item.name}</option>
                  ))}
                </optgroup>
                <optgroup label="シナリオ">
                  {options.scenarios.map((item) => (
                    <option key={`scenario-${item.id}`} value={`scenario:${item.id}`}>{item.name}</option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown size={14} aria-hidden="true" className={styles.selectIcon} />
            </span>
          </label>
        </div>
        <div className={styles.actionButtons} role="group" aria-label="足す操作の種類">
          {ACTION_BUTTONS.map((button) => (
            <button
              key={button.label}
              type="button"
              disabled={!button.enabled || !canEdit || !draftTarget}
              title={!canEdit ? 'この操作にはオーナーか管理者の権限が要ります' : button.reason}
              className={styles.actionButton}
              onClick={() => {
                const [kind, id] = draftTarget.split(':')
                const target = kind === 'scenario'
                  ? options.scenarios.find((item) => item.id === id)
                  : options.tags.find((item) => item.id === id)
                if (!id || !target) return
                if (button.type === 'start_scenario' && kind !== 'scenario') return
                if (button.type === 'add_tag' && kind !== 'tag') return
                const label = button.type === 'start_scenario'
                  ? `シナリオ「${target.name}」を始める`
                  : `タグ「${target.name}」を付ける`
                setDefinition((current) => ({ ...current, actions: [...current.actions, { type: button.type, label, targetId: id }] }))
                setDraftTarget('')
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

/* ===== 作る⑤ 確認（板 `U8Xm3X`） ===== */

function PreviewStepV8({ rule, definition, options, runTest, testing, testOk, overlapNotes, slackConnected, canEdit, hrefFor }: {
  rule: EditorRule
  definition: FriendAddRuleDefinition
  options: FriendAddRuleOptions
  runTest: () => void
  testing: boolean
  testOk: boolean
  overlapNotes: string[]
  slackConnected: boolean | null
  canEdit: boolean
  hrefFor: (next: Step, extra?: string) => string
}) {
  const routeNames = definition.routeIds
    .map((id) => options.routes.find((route) => route.id === id)?.name)
    .filter((name): name is string => Boolean(name))
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
  const suppressText = resendSuppressionText(definition.resendSuppressionHours)
  return (
    <>
      <section className={styles.card} aria-label="設定の確認">
        <h3 className={styles.cardTitle}>設定の確認</h3>
        <dl className={styles.confirmRows}>
          <div className={styles.confirmRow}>
            <dt>名前・フォルダ</dt>
            <dd>{rule.name || '（未入力）'}{rule.folderName ? `・${rule.folderName}` : ''}</dd>
            <dd><a className={styles.textLink} href={hrefFor('basic')}>変える</a></dd>
          </div>
          <div className={styles.confirmRow}>
            <dt>だれに</dt>
            <dd>{rule.friendKind === 'returning' ? '以前からの友だち・ブロック解除した人' : 'はじめて友だち追加した人'}</dd>
            <dd><a className={styles.textLink} href={hrefFor('basic')}>変える</a></dd>
          </div>
          <div className={styles.confirmRow}>
            <dt>流入リンク</dt>
            <dd>{routeNames.length > 0 ? routeNames.join('・') : '未選択'}</dd>
            <dd><a className={styles.textLink} href={hrefFor('routes')}>変える</a></dd>
          </div>
          <div className={styles.confirmRow}>
            <dt>最初に送るもの</dt>
            <dd>{firstSend}{definition.timing === 'immediate' ? '・追加してすぐ' : ''}</dd>
            <dd><a className={styles.textLink} href={hrefFor('message')}>変える</a></dd>
          </div>
          <div className={styles.confirmRow}>
            <dt>あわせて行うこと</dt>
            <dd>{actionSummary}</dd>
            <dd><a className={styles.textLink} href={hrefFor('actions')}>変える</a></dd>
          </div>
          <div className={styles.confirmRow}>
            <dt>順番</dt>
            <dd>{rule.priority}番目（「経路が分からなかった人」の前）</dd>
            <dd><a className={styles.textLink} href="/friend-add-settings">変える</a></dd>
          </div>
        </dl>
      </section>
      <section className={styles.card} aria-label="テストする（送らずに判定）">
        <h3 className={styles.cardTitle}>テストする（送らずに判定）</h3>
        <p className={styles.cardDesc}>本番の登録・タグ・マイルは変えません</p>
        <div className={styles.testRow}>
          <span className={styles.testTarget}>送り先：自分（送らずに判定）</span>
          <Button type="button" variant="secondary" disabled={!canEdit || testing} busy={testing} busyLabel="判定中…" onClick={runTest}>
            テストする（送らずに判定）
          </Button>
        </div>
        <p className={styles.cardDesc}>{testOk ? 'テストで判定が通りました。' : 'まだテストしていません'}</p>
      </section>
      <section className={styles.card} aria-label="有効にする前の確認">
        <h3 className={styles.cardTitle}>有効にする前の確認</h3>
        <ul className={styles.checkList}>
          <li className={styles.checkRow}>
            <span className={overlapOk ? styles.checkOk : styles.checkNg} aria-hidden="true">
              {overlapOk ? <Check size={13} /> : '!'}
            </span>
            <span className={styles.checkText}>
              <strong>流入リンクの重なりがない</strong>
              <small>{overlapOk ? `選んだ${definition.routeIds.length}つは、ほかの設定で使われていません` : overlapNotes[0]}</small>
            </span>
            <a className={styles.textLink} href={hrefFor('routes')}>見直す</a>
          </li>
          <li className={styles.checkRow}>
            <span className={styles.checkOk} aria-hidden="true"><Check size={13} /></span>
            <span className={styles.checkText}>
              <strong>二重送信を防ぐ</strong>
              <small>同じ人へは{suppressText}まで</small>
            </span>
            <a className={styles.textLink} href={hrefFor('message')}>見直す</a>
          </li>
          <li className={styles.checkRow}>
            <span className={testOk ? styles.checkOk : styles.checkNg} aria-hidden="true">
              {testOk ? <Check size={13} /> : '!'}
            </span>
            <span className={styles.checkText}>
              <strong>テストで判定を確かめた</strong>
              <small>{testOk ? 'テストで判定が通りました' : 'テストで判定が通るまで、有効にはできません'}</small>
            </span>
            <button type="button" className={styles.textLink} disabled={!canEdit || testing} onClick={runTest}>直す</button>
          </li>
          <li className={styles.checkRow}>
            <span className={slackConnected === false ? styles.checkNg : styles.checkOk} aria-hidden="true">
              {slackConnected === false ? '!' : <Check size={13} />}
            </span>
            <span className={styles.checkText}>
              <strong>失敗をSlackへ知らせる</strong>
              <small>未送信・二重送信・シナリオ開始失敗を知らせます{slackConnected === true ? '（接続済み）' : slackConnected === false ? '（未接続）' : ''}</small>
            </span>
            <a className={styles.textLink} href="/line-notifications/operator/new">見直す</a>
          </li>
        </ul>
      </section>
    </>
  )
}

/* ===== 右の「設定内容」とスマホの見え方 ===== */

function EditorSummaryV8({ step, rule, definition, options }: {
  step: Step
  rule: EditorRule
  definition: FriendAddRuleDefinition
  options: FriendAddRuleOptions
}) {
  const routeNames = definition.routeIds
    .map((id) => options.routes.find((route) => route.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const noneMode = rule.friendKind === 'returning' && definition.returningMode === 'none'
  const firstSendShort = noneMode
    ? '配信なし'
    : definition.messageType === 'text' && definition.messageText
      ? `テキスト ${definition.messageText.length}字`
      : step === 'basic' || step === 'routes'
        ? '手順3で作る'
        : MESSAGE_TYPE_LABEL[definition.messageType] ?? '未設定'
  const firstSendFull = noneMode
    ? '配信なし'
    : definition.messageType === 'text' && definition.messageText
      ? `テキスト＋${definition.actions.length}つの処理`
      : MESSAGE_TYPE_LABEL[definition.messageType] ?? '未設定'
  const statusLabel = rule.status === 'published' ? '有効' : rule.status === 'stopped' ? '停止中' : '下書き'
  return (
    <aside className={styles.side} aria-label="設定内容">
      <section className={styles.card} aria-label="設定内容">
        <h3 className={styles.cardTitle}>設定内容</h3>
        <dl className={styles.summaryRows}>
          <div className={styles.summaryRow}>
            <dt>だれに</dt>
            <dd>{rule.friendKind === 'returning' ? '以前からの友だち' : 'はじめての人'}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>流入リンク</dt>
            <dd>
              {step === 'basic'
                ? '手順2で選ぶ'
                : routeNames.length > 0
                  ? `${routeNames.length}つ（${routeNames[0]}${routeNames.length > 1 ? 'ほか' : ''}）`
                  : '未選択'}
            </dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>最初に送るもの</dt>
            <dd>{step === 'actions' || step === 'preview' ? firstSendFull : firstSendShort}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>状態</dt>
            <dd>{step === 'preview' ? `${statusLabel} → 有効にする` : statusLabel}</dd>
          </div>
        </dl>
      </section>
      {step === 'basic' ? (
        <p className={styles.sideNote}>LINEでの見え方は、届けるメッセージを決める手順から右に出ます。</p>
      ) : (
        <section aria-label="LINEでの見え方">
          <h3 className={styles.phoneTitle}>LINEでの見え方</h3>
          <div className={styles.phone} aria-label="LINEのメッセージの見え方">
            <p className={styles.phoneHead}>友だち追加しました</p>
            <div className={styles.phoneBubble}>
              {noneMode
                ? '再追加では配信しません。案内後の操作だけを行います。'
                : definition.messageText || '初回案内は手順3で作ります'}
            </div>
          </div>
        </section>
      )}
    </aside>
  )
}
