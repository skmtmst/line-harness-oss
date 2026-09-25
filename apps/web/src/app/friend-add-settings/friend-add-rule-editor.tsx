'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronRight, Plus, X } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { RequiredBadge } from '@/components/shared/form-controls'
import ConditionBuilder from '@/components/shared/condition-builder'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import type {
  FriendAddRule,
  FriendAddRuleAction,
  FriendAddRuleDefinition,
  FriendAddRuleInput,
  FriendAddRuleKind,
  FriendAddRuleOptions,
} from '@/lib/api'
import type { SegmentCondition } from '@/lib/segment-condition'
import { pruneCondition } from '@/lib/segment-condition'
import { api } from '@/lib/api'
import {
  addTimeWindow,
  friendAddFlowSteps,
  friendAddReaddLines,
  MESSAGE_TYPE_LABEL,
  removeTimeWindow,
  timeWindowsSummary,
  updateTimeWindow,
} from './friend-add-flow'
import { resendSuppressionText } from './friend-add-text'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import './friend-add-rule-editor.css'

type Step = 'basic' | 'routes' | 'message' | 'actions' | 'preview'
type EditorRule = Pick<FriendAddRule, 'name' | 'folderName' | 'priority' | 'friendKind' | 'isFallback' | 'status' | 'matchedLast7Days' | 'lastTestStatus' | 'version'>
const STEPS: Array<{ key: Step; order: number; label: string; node: string }> = [
  { key: 'basic', order: 1, label: '基本設定', node: 's9gAx' },
  { key: 'routes', order: 2, label: '流入条件', node: 'W1wzCa' },
  { key: 'message', order: 3, label: '初回案内', node: 'K0Dbr2' },
  { key: 'actions', order: 4, label: 'アクション', node: 'txMO9' },
  { key: 'preview', order: 5, label: '確認', node: 'U3SI5' },
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
  unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeWindows: [{ start: '08:00', end: '21:00' }],
}

/** 保存済みかの比較には版番号を含めない。保存成功でサーバが版を進めても、入力が変わった扱いにしない。 */
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

export default function FriendAddRuleEditor({ ruleId }: { ruleId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const requestedStep = searchParams.get('step') as Step | null
  const step: Step = STEPS.some((item) => item.key === requestedStep) ? requestedStep! : 'basic'
  usePageTitle(step === 'actions' && searchParams.get('dialog') === 'add'
    ? '実行アクションを追加'
    : step === 'preview' ? 'プレビューとテスト' : `友だち追加時・${STEPS.find((item) => item.key === step)?.label ?? '基本設定'}`)
  const actionDialogOpen = step === 'actions' && searchParams.get('dialog') === 'add'
  const [rule, setRule] = useState<EditorRule>({
    name: '', folderName: null, priority: 1, friendKind: 'first_time', isFallback: false,
    status: 'draft', matchedLast7Days: null, lastTestStatus: null, version: 0,
  })
  const [definition, setDefinition] = useState<FriendAddRuleDefinition>(EMPTY_DEFINITION)
  const [options, setOptions] = useState<FriendAddRuleOptions>({ routes: [], scenarios: [], tags: [], folders: [] })
  const [matchedLast28Days, setMatchedLast28Days] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /*
   * テスト結果は「どのアカウント・どの設定・どの版で実行したか」を持たせる
   * （FRIENDADD-03）。設定変更やアカウント/ルール切替後に、別設定で取れた
   * 結果を今の設定の結果として表示しない。
   */
  const [testResult, setTestResult] = useState<{
    accountId: string
    ruleId: string
    snapshot: string
    matched: boolean
    reasons: string[]
    stateChanged: false
  } | null>(null)
  const [actionType, setActionType] = useState<FriendAddRuleAction['type']>('add_tag')
  // `txMO9` は3件目の「配信済み」タグを選んで確認を開いた状態が正本。
  const [actionTarget, setActionTarget] = useState(actionDialogOpen ? 'tag-delivered' : '')
  const saveIdempotencyKey = useRef(crypto.randomUUID())
  const saveInFlight = useRef(false)
  const savedSnapshot = useRef<string | null>(null)
  /*
   * アカウント切替で遅れて返る前のアカウントの応答が、切替先の設定・候補を
   * 上書きしないよう、読込ごとに対象と世代を持つ（FRIENDADD-02）。
   * loadedAccountId は「画面に出ている設定がどのアカウントのものか」で、
   * 保存先と読込対象が一致するときだけ保存・テストを許す。
   */
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
        const conflicts = await api.friendAddRules.conflicts(request.accountId, response.data.rule.friendKind)
        if (!isCurrentRequest()) return
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
        setMatchedLast28Days(conflicts.success
          ? conflicts.data.rules.find((item) => item.id === ruleId)?.matchedLast28Days ?? 0
          : null)
        setLoadedAccountId(request.accountId)
      } else {
        const response = await api.friendAddRules.list(request.accountId, 'first_time')
        if (!isCurrentRequest()) return
        if (!response.success) { setError(response.error); return }
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        /*
         * 優先順位は通常設定の最後の次の番号にする。いちばん最後に動く
         * 受け皿（`isFallback`）の 999999 を含めると、初期値が
         * 1000000 になってしまう（全ルート監査 A3、2026-09-25）。
         * 競合一覧は全件だが受け皿の印を持たないので、一覧の id と
         * 突き合わせて受け皿を外す。一覧は既定20件のため、競合一覧を
         * 主にし、取れないときだけ一覧の受け皿以外の件数+1にする。
         */
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
    } catch {
      if (isCurrentRequest()) setError('設定を読み込めませんでした。')
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [ruleId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const currentIndex = STEPS.findIndex((item) => item.key === step)
  const hrefFor = (next: Step, extra = '') => ruleId
    ? `/friend-add-settings?view=edit&id=${encodeURIComponent(ruleId)}&step=${next}${extra}`
    : `/friend-add-settings?view=new&step=${next}${extra}`
  const input = (): FriendAddRuleInput | null => {
    // 表示中の設定が別アカウントのものなら保存しない（切替中の誤保存防止）。
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

  /*
   * 最後に保存した版から入力が変わっている間、画面を離れる操作を止める
   * 共通の番兵（DETAIL-04系）。段移動は「保存してから進む」既存の動きの
   * ままにし、画面外への離脱（左メニュー・戻る・再読込）を確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: hasUnsavedChanges, busy: saving })

  const validate = () => {
    if (!rule.name.trim()) return '設定名を入力してください。'
    // 再追加で「何も配信しない」ときはシナリオを使わない (サーバも同じ判断)。
    const skipsScenario = rule.friendKind === 'returning' && definition.returningMode === 'none'
    if (!definition.scenarioId && !skipsScenario) return '実際に配信するシナリオを決めてください。'
    if (!rule.isFallback && definition.routeIds.length === 0) return '対象にする流入リンクを1つ以上選んでください。'
    return ''
  }

  const save = async (nextStep?: Step): Promise<string | null> => {
    // disabledが描画される前の連打もここで止める。状態だけでは同じ描画内の
    // 2回目を防げないため、同期refを保存完了まで保持する。
    if (saveInFlight.current) return null
    const payload = input()
    if (!payload) {
      setError(selectedAccountId && loadedAccountId !== selectedAccountId
        ? 'アカウントを切り替えています。読み込みが終わってから保存してください。'
        : 'LINE公式アカウントを選んでください。')
      return null
    }
    const problem = validate()
    if (problem && step !== 'basic') { setError(problem); return null }
    if (!rule.name.trim()) { setError('設定名を入力してください。'); return null }
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
      // 同じ冪等キーを使い回すと、サーバが変更を適用せず現在値を返す
      // (replay)。保存が通るたびにキーを回し、応答の版番号を手元へ反映する。
      // なお response.data の型は api.ts 側が `{ id; versionId }` のままなので、
      // 版番号は存在確認つきで読む(api.ts の型更新は所有レーンへ依頼 #524)。
      saveIdempotencyKey.current = crypto.randomUUID()
      const savedVersion = (response.data as { version?: number }).version
      if (typeof savedVersion === 'number') {
        setRule((current) => ({ ...current, version: savedVersion }))
      }
      savedSnapshot.current = editorSnapshot(rule, definition)
      setNotice('下書きを保存しました。')
      if (!ruleId || nextStep) router.replace(`/friend-add-settings?view=edit&id=${encodeURIComponent(savedId)}&step=${nextStep ?? step}`)
      return savedId
    } catch {
      setError('下書きを保存できませんでした。通信を確認して、もう一度お試しください。')
      return null
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const moveToStep = (nextStep: Step) => {
    if (nextStep === step || saving) return
    // 保存済みの段を見直すだけなら通信せずに移動する。入力が変わっているとき
    // だけ、保存成功後に遷移するので失敗・競合時に表示中の値を失わない。
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
      const response = await api.friendAddRules.test(selectedAccountId, activeId)
      /*
       * テストは保存済みの版で実行される。結果には実行時のアカウント・ルール・
       * 保存済みスナップショットを持たせ、あとから設定を変えたり別ルールへ
       * 移ったりしたときに古い結果を今の設定の判定として見せない。
       */
      const testedMeta = {
        accountId: selectedAccountId,
        ruleId: activeId,
        snapshot: savedSnapshot.current ?? editorSnapshot(rule, definition),
      }
      /*
       * 失敗時も理由 (reasons) が返る。失敗で return だけすると理由が捨てられ、
       * 確認面の失敗分岐に届かない。理由を入れてから知らせる。
       */
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

  const toggleRoute = (id: string) => setDefinition((current) => ({
    ...current,
    routeIds: current.routeIds.includes(id) ? current.routeIds.filter((routeId) => routeId !== id) : [...current.routeIds, id],
  }))

  const actionLabel = useMemo(() => {
    if (actionType === 'add_tag') return `タグ「${options.tags.find((tag) => tag.id === actionTarget)?.name ?? '未選択'}」を付ける`
    if (actionType === 'remove_tag') return `タグ「${options.tags.find((tag) => tag.id === actionTarget)?.name ?? '未選択'}」を外す`
    if (actionType === 'start_scenario') return `シナリオ「${options.scenarios.find((scenario) => scenario.id === actionTarget)?.name ?? '未選択'}」を開始する`
    return 'シナリオを開始する'
  }, [actionTarget, actionType, options.scenarios, options.tags])

  const addAction = () => {
    if (!actionTarget) { setError('アクションの対象を選んでください。'); return }
    setDefinition((current) => ({ ...current, actions: [...current.actions, { type: actionType, label: actionLabel, targetId: actionTarget }] }))
    router.replace(hrefFor('actions'))
  }

  if (accountLoading || loading) return <ListState kind="loading" title="設定を読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで対象を選んでください。' : '先にLINE公式アカウントを登録してください。'} />
  /*
   * 切替直後や切替先の読込に失敗したとき、手元に残った前のアカウントの
   * 設定を別アカウントのものとして表示しない（FRIENDADD-02）。
   */
  if (loadedAccountId !== selectedAccountId) {
    return error
      ? <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />
      : <ListState kind="loading" title="設定を読み込んでいます" />
  }
  if (error && !rule.name && ruleId) return <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />

  /*
   * テスト結果は、実行したときのアカウント・ルール・保存済み設定と
   * 今の画面が一致するときだけ表示する。設定を変更したあとの
   * 「変更後は未確認」に戻す扱い（FRIENDADD-03）。
   */
  const currentSnapshot = editorSnapshot(rule, definition)
  const visibleTestResult = testResult
    && testResult.accountId === selectedAccountId
    && testResult.ruleId === (ruleId ?? testResult.ruleId)
    && testResult.snapshot === currentSnapshot
    ? testResult
    : null

  const node = STEPS[currentIndex].node
  return (
    <div className={'friend-add-editor-page'} data-design-node={node}>
      <a className={'friend-add-editor-backLink'} href="/friend-add-settings">← 友だち追加時の配信</a>
      <nav className={'friend-add-editor-steps'} aria-label="友だち追加時配信の作成手順">
        {STEPS.map((item, index) => (
          <button key={item.key} type="button" aria-current={item.key === step ? 'step' : undefined} onClick={() => moveToStep(item.key)}>
            <span className={index < currentIndex ? 'friend-add-editor-stepDone' : item.key === step ? 'friend-add-editor-stepCurrent' : 'friend-add-editor-stepTodo'}>{index < currentIndex ? <Check size={14} /> : item.order}</span>
            <span><small>STEP {item.order}</small><strong>{item.label}</strong></span>
          </button>
        ))}
      </nav>

      {error && <div className={'friend-add-editor-error'} role="alert">{error}</div>}
      {notice && <div className={'friend-add-editor-notice'}>{notice}</div>}

      <div className={'friend-add-editor-layout'}>
        <div className={step === 'preview' ? 'friend-add-editor-panel friend-add-editor-panelSplit' : 'friend-add-editor-panel'}>
          {step === 'basic' && <BasicStep rule={rule} setRule={setRule} definition={definition} setDefinition={setDefinition} options={options} />}
          {step === 'routes' && <RoutesStep rule={rule} definition={definition} options={options} toggleRoute={toggleRoute} setDefinition={setDefinition} />}
          {step === 'message' && <MessageStep definition={definition} setDefinition={setDefinition} friendKind={rule.friendKind} scenarios={options.scenarios} openActions={() => moveToStep('actions')} />}
          {step === 'actions' && <ActionsStep definition={definition} setDefinition={setDefinition} options={options} actionType={actionType} actionTarget={actionTarget} setActionType={setActionType} setActionTarget={setActionTarget} openDialog={() => router.replace(hrefFor('actions', '&dialog=add'))} />}
          {step === 'preview' && <PreviewStep rule={rule} definition={definition} options={options} result={visibleTestResult} resultStale={Boolean(testResult && !visibleTestResult)} />}
        </div>
        <Summary step={step} rule={rule} definition={definition} options={options} matchedLast28Days={matchedLast28Days} pendingAction={actionDialogOpen && Boolean(actionTarget)} />
      </div>

      <StickyBar className="friend-add-editor-sticky" status={notice || undefined} actions={<><Button href="/friend-add-settings">キャンセル</Button><Button type="button" onClick={() => void save()} disabled={saving}>下書き保存</Button>{step === 'preview' ? <Button type="button" variant="primary" onClick={() => void runTest()} disabled={saving}>{saving ? 'テスト中…' : 'テスト送信'}</Button> : <Button type="button" variant="primary" onClick={() => moveToStep(STEPS[Math.min(currentIndex + 1, 4)].key)} disabled={saving}>{STEPS[Math.min(currentIndex + 1, 4)].label}へ</Button>}</>} />

      {actionDialogOpen && (
        <div data-design-node="txMO9">
          <Dialog
            open
            title="アクションを追加"
            description={`選択した${definition.actions.length + 1}件のアクションを配信フローへ追加します。`}
            titleIcon={<Check size={18} />}
            cancelLabel="初回案内へ戻る"
            confirmLabel="アクションを追加"
            confirmIcon={<Plus size={16} />}
            designNode="txMO9"
            onCancel={() => router.replace(hrefFor('actions'))}
            onConfirm={addAction}
          />
        </div>
      )}

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="このまま移動すると、保存していない変更は失われます。保存せずに移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

function BasicStep({ rule, setRule, definition, setDefinition, options }: { rule: EditorRule; setRule: React.Dispatch<React.SetStateAction<EditorRule>>; definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; options: FriendAddRuleOptions }) {
  /*
   * フォルダは表にあるものから選ぶ。自由入力にすると表に無い名が増え、
   * 整理が壊れる。新しい束は一覧の「フォルダを追加」で作る。
   */
  const folderOptions = options.folders.some((folder) => folder.name === (rule.folderName ?? ''))
    ? options.folders
    : rule.folderName ? [...options.folders, { id: rule.folderName, name: rule.folderName }] : options.folders
  return <Section title="基本設定" description="管理名・フォルダ・優先順位を設定します。"><div className={'friend-add-editor-twoCols'}><Field label="設定名" required><TextField value={rule.name} maxLength={60} onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} /><small>{rule.name.length} / 60文字　友だちには表示されません</small></Field><Field label="フォルダ"><SelectField value={rule.folderName ?? ''} onChange={(event) => setRule((current) => ({ ...current, folderName: event.target.value || null }))} options={[{ value: '', label: '未分類' }, ...folderOptions.map((folder) => ({ value: folder.name, label: folder.name }))]} /></Field><Field label="優先順位"><TextField type="number" min={1} value={rule.priority} onChange={(event) => setRule((current) => ({ ...current, priority: Math.max(1, Number(event.target.value) || 1) }))} /></Field><Field label="判定する人"><SelectField value={rule.friendKind} disabled={rule.isFallback} onChange={(event) => setRule((current) => ({ ...current, friendKind: event.target.value as FriendAddRuleKind }))} options={[{ value: 'first_time', label: 'はじめて友だち追加した人' }, { value: 'returning', label: '以前からの友だち・ブロック解除した人' }]} /></Field>{rule.friendKind === 'returning' && !rule.isFallback && <Field label="再追加時の配信"><SelectField value={definition.returningMode ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, returningMode: (event.target.value || undefined) as FriendAddRuleDefinition['returningMode'] }))} options={[{ value: '', label: '選んでください' }, { value: 'none', label: '何も配信しない' }, { value: 'same', label: 'はじめてと同じ内容' }, { value: 'other', label: '別のシナリオ' }]} /><small>「何も配信しない」はシナリオなしで保存できます。</small></Field>}</div><Field label="社内メモ"><TextArea value={definition.internalMemo ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, internalMemo: event.target.value }))} placeholder="この設定を使う理由を残せます。配信の条件には使いません。" /></Field></Section>
}

function RoutesStep({ rule, definition, options, toggleRoute, setDefinition }: { rule: Pick<FriendAddRule, 'isFallback'>; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions; toggleRoute: (id: string) => void; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>> }) {
  /*
   * 時間帯は配列で保存される。先頭だけを表示して配列全体を1件で置き換えると
   * 2件目以降が消えるため、全件を表示・編集する（FRIENDADD-05）。
   */
  const windows = definition.timeWindows ?? []
  const weekdays = definition.weekdays ?? []
  return (
    <Section title="どの流入から来た人か" description="「流入と計測」で作ったリンクから選びます。ここに無いものは、流入と計測で作成します。">
      {rule.isFallback ? (
        <div className={'friend-add-editor-info'}>この設定は、流入経路を確定できなかった人へ最後に動きます。</div>
      ) : (
        <div className={'friend-add-editor-routeList'}>
          {options.routes.map((route) => (
            <label key={route.id} className={definition.routeIds.includes(route.id) ? 'friend-add-editor-routeSelected' : 'friend-add-editor-route'}>
              <input type="checkbox" checked={definition.routeIds.includes(route.id)} onChange={() => toggleRoute(route.id)} />
              <span><strong>{route.name}</strong><small>{route.kind}</small></span>
            </label>
          ))}
        </div>
      )}
      <Field label="曜日">
        <div className={'friend-add-editor-weekdays'}>
          {['日', '月', '火', '水', '木', '金', '土'].map((label, day) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={weekdays.includes(day)}
                onChange={() => setDefinition((current) => ({
                  ...current,
                  weekdays: weekdays.includes(day) ? weekdays.filter((value) => value !== day) : [...weekdays, day].sort(),
                }))}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>
      <div className={'friend-add-editor-field'}>
        <span>配信する時間帯</span>
        <div className={'friend-add-editor-windowList'}>
          {windows.length === 0 && <p className={'friend-add-editor-helper'}>時間帯の制限はありません。</p>}
          {windows.map((slot, index) => (
            <div key={index} className={'friend-add-editor-windowRow'}>
              <TimeField
                aria-label={`時間帯${index + 1}の開始`}
                value={slot.start}
                onChange={(v) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { start: v }) }))}
                className="w-32"
              />
              <span>〜</span>
              <TimeField
                aria-label={`時間帯${index + 1}の終了`}
                value={slot.end}
                onChange={(v) => setDefinition((current) => ({ ...current, timeWindows: updateTimeWindow(current.timeWindows, index, { end: v }) }))}
                className="w-32"
              />
              <IconButton
                aria-label={`時間帯${index + 1}を削除`}
                onClick={() => setDefinition((current) => ({ ...current, timeWindows: removeTimeWindow(current.timeWindows, index) }))}
              >
                <X size={16} />
              </IconButton>
            </div>
          ))}
        </div>
        <div><Button type="button" onClick={() => setDefinition((current) => ({ ...current, timeWindows: addTimeWindow(current.timeWindows) }))}><Plus size={16} />時間帯を追加</Button></div>
      </div>
      <div className={'friend-add-editor-twoCols'}>
        <Field label="有効期間の開始"><DateTimeField aria-label="有効期間の開始" value={definition.activeFrom ?? ''} onChange={(v) => setDefinition((current) => ({ ...current, activeFrom: v || null }))} /></Field>
        <Field label="有効期間の終了"><DateTimeField aria-label="有効期間の終了" value={definition.activeUntil ?? ''} onChange={(v) => setDefinition((current) => ({ ...current, activeUntil: v || null }))} /></Field>
      </div>
      <FriendConditionField definition={definition} setDefinition={setDefinition} />
      <p className={'friend-add-editor-helper'}>同じ友だちが複数の流入条件に当てはまったときは、優先順位の小さいものだけを実行します。</p>
    </Section>
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

function isLegacyFriendCondition(value: string): boolean {
  if (!value.trim()) return false
  return parseFriendConditionJson(value) == null
}

function friendConditionSummary(value: string): string {
  if (!value.trim()) return '未設定'
  return parseFriendConditionJson(value) ? '設定あり' : '要再設定（以前の形式）'
}

function FriendConditionField({ definition, setDefinition }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>> }) {
  const raw = definition.friendCondition ?? ''
  const legacy = isLegacyFriendCondition(raw)
  const value = parseFriendConditionJson(raw)
  return (
    <Field label="この初回案内を使う友だち">
      {legacy && (
        <div className={'friend-add-editor-error'} role="alert">以前の形式の条件が入っているため、今は配信を止めています。下の条件を作り直してください。メモは「基本設定」の社内メモへ移動できます。</div>
      )}
      <ConditionBuilder
        value={value}
        onChange={(next) => {
          const pruned = pruneCondition(next)
          setDefinition((current) => ({ ...current, friendCondition: pruned ? JSON.stringify(pruned) : '' }))
        }}
        label="この初回案内を使う友だち"
        showCount={false}
      />
      <p className={'friend-add-editor-helper'}>条件を空にすると全員に送ります。以前のメモ形式は配信に使いません。</p>
    </Field>
  )
}

function MessageStep({ definition, setDefinition, friendKind, scenarios, openActions }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; friendKind: FriendAddRuleKind; scenarios: FriendAddRuleOptions['scenarios']; openActions: () => void }) {
  const unknownRoute = definition.unknownRouteAction ?? { sendCommonGuidance: true, notifyStaff: false }
  /*
   * 実際に配信するシナリオは保存の必須項目（FRIENDADD-01）。ただし再追加で
   * 「何も配信しない」を選んだときはシナリオを使わないので、選ばせない。
   */
  const skipsScenario = friendKind === 'returning' && definition.returningMode === 'none'
  return (
    <Section title="初回案内" description="最初に届けるメッセージと選択肢を設定します。">
      <div className={'friend-add-editor-messageTabs'}>{(['text', 'template', 'form'] as const).map((type) => <button type="button" key={type} className={definition.messageType === type ? 'friend-add-editor-messageTabActive' : 'friend-add-editor-messageTab'} onClick={() => setDefinition((current) => ({ ...current, messageType: type }))}>{type === 'text' ? 'テキスト' : type === 'template' ? 'テンプレート' : '回答フォーム'}</button>)}</div>
      {definition.messageType !== 'scenario' && <Field label="初回メッセージ" required><TextArea rows={7} value={definition.messageText} onChange={(event) => setDefinition((current) => ({ ...current, messageText: event.target.value }))} placeholder="友だち追加ありがとうございます。まずはご希望の内容をお選びください。" /></Field>}
      <div className={'friend-add-editor-messageChoices'} aria-label="初回メッセージの選択肢"><span>サービスを見る</span><span>相談を予約</span><span>お問い合わせ</span></div>
      <div className={'friend-add-editor-twoCols'}>
        <Field label="追加から送信まで"><SelectField value={definition.timing} onChange={(event) => setDefinition((current) => ({ ...current, timing: event.target.value as FriendAddRuleDefinition['timing'] }))} options={[{ value: 'immediate', label: '登録直後' }, { value: 'scenario', label: 'シナリオの時刻に従う' }]} /></Field>
        <Field label="再追加時の制限"><SelectField value={String(definition.resendSuppressionHours ?? 24)} onChange={(event) => setDefinition((current) => ({ ...current, resendSuppressionHours: Number(event.target.value) }))} options={[{ value: '0', label: '制限しない' }, { value: '24', label: '24時間に1回' }, { value: '168', label: '7日に1回' }]} /></Field>
      </div>
      {skipsScenario ? (
        <p className={'friend-add-editor-helper'}>再追加時「何も配信しない」を選んでいるため、配信シナリオは不要です。</p>
      ) : (
        <Field label="次に流すシナリオ" required>
          <SelectField
            value={definition.scenarioId ?? ''}
            onChange={(event) => setDefinition((current) => ({ ...current, scenarioId: event.target.value || null }))}
            options={[{ value: '', label: '選んでください' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
          />
          <small>初回案内のあとに登録するシナリオです。このアカウントのシナリオだけ選べます。</small>
        </Field>
      )}
      <div className={'friend-add-editor-actionSummary'}><div><strong>案内後のアクション</strong><button type="button" onClick={openActions}>アクションを追加</button></div><p>{definition.actions.length ? definition.actions.map((action) => action.label).join('／') : '追加のアクションはありません'}</p></div>
      <Field label="流入経路が不明な場合">
        <small>共通案内を送るか、何もしないか選べます。</small>
        <div className={'friend-add-editor-choiceList'}>
          <label><input type="radio" name="unknown-route-action" checked={unknownRoute.sendCommonGuidance} onChange={() => setDefinition((current) => ({ ...current, unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false } }))} />共通案内を送る</label>
          <label><input type="radio" name="unknown-route-action" checked={!unknownRoute.sendCommonGuidance} onChange={() => setDefinition((current) => ({ ...current, unknownRouteAction: { sendCommonGuidance: false, notifyStaff: false } }))} />何もしない</label>
        </div>
      </Field>
    </Section>
  )
}

function ActionsStep({ definition, setDefinition, options, actionType, actionTarget, setActionType, setActionTarget, openDialog }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; options: FriendAddRuleOptions; actionType: FriendAddRuleAction['type']; actionTarget: string; setActionType: (value: FriendAddRuleAction['type']) => void; setActionTarget: (value: string) => void; openDialog: () => void }) {
  return <Section title="アクションの種類" description="友だち追加後に自動実行する内容を選びます。"><div className={'friend-add-editor-twoCols'}><Field label="アクション"><SelectField value={actionType} onChange={(event) => { setActionType(event.target.value as FriendAddRuleAction['type']); setActionTarget('') }} options={[{ value: 'add_tag', label: 'タグを付与' }, { value: 'remove_tag', label: 'タグを解除' }, { value: 'start_scenario', label: 'シナリオを開始' }]} /></Field><Field label="実行タイミング"><TextField value="登録直後" disabled /></Field></div><Field label="設定内容"><SelectField value={actionTarget} onChange={(event) => setActionTarget(event.target.value)} options={[{ value: '', label: '選んでください' }, ...(actionType === 'start_scenario' ? options.scenarios : options.tags).map((item) => ({ value: item.id, label: item.name }))]} /></Field><div className={'friend-add-editor-actionList'}>{definition.actions.length === 0 ? <p>追加のアクションはありません。</p> : definition.actions.map((action, index) => <div key={`${action.type}-${index}`}><span>{index + 1}</span><strong>{action.label}</strong><IconButton aria-label={`${action.label}を外す`} onClick={() => setDefinition((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))}><X size={16} /></IconButton></div>)}</div><Button type="button" variant="primary" onClick={openDialog} disabled={!actionTarget}><Plus size={16} />アクションを追加</Button></Section>
}

function PreviewStep({ rule, definition, options, result, resultStale }: { rule: EditorRule; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions; result: { matched: boolean; reasons: string[]; stateChanged: false } | null; resultStale: boolean }) {
  /*
   * IDEA-09: 選択した経路の「初回案内・付く属性・次の配信」を順に確認できる
   * 説明を、保存済みの定義から組み立てる。固定の例示で埋めない
   * （設定していない画像・タグ・時刻・ボタンを出さない = FRIENDADD-04 と同じ方向）。
   * ここは画面の説明だけで、実際の追加・送信・属性更新は行わない。
   */
  const routeNames = definition.routeIds
    .map((id) => options.routes.find((route) => route.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const missingRouteCount = definition.routeIds.length - routeNames.length
  const scenarioName = definition.scenarioId
    ? options.scenarios.find((scenario) => scenario.id === definition.scenarioId)?.name ?? null
    : null
  const steps = friendAddFlowSteps({
    isFallback: rule.isFallback,
    routeNames,
    missingRouteCount,
    definition,
    scenarioName,
  })
  const readdLines = friendAddReaddLines({
    friendKind: rule.friendKind,
    status: rule.status,
    definition,
  })
  return <><Section title="テスト対象" description="実際の友だちへは送信せず、保存済みの設定で判定を確認します。"><div className={'friend-add-editor-twoCols'}><Field label="送信先"><TextField value="送信しません（条件の確認のみ）" disabled /></Field><Field label="テスト方法"><TextField value="保存済みの設定で判定を確認" disabled /></Field></div></Section><Section title="確認内容" description="この経路から追加された人に起きることを順に確認します。"><div className={'friend-add-editor-sequence'}>{steps.map((item, index) => <div key={item.key}><span>{index + 1}</span><strong>{item.title}</strong><small>{item.detail}</small><ChevronRight size={16} /></div>)}</div><div className={'friend-add-editor-info'}><strong>再追加・ブロック解除のとき</strong><ul>{readdLines.map((line) => <li key={line}>{line}</li>)}</ul></div><p className={'friend-add-editor-helper'}>この確認は画面の説明だけです。実際の友だち追加・送信・属性の更新は行いません。</p>{resultStale && <p className={'friend-add-editor-helper'}>設定を変更したため、前回のテスト結果は表示していません。「テスト送信」は保存済みの設定で実行します。</p>}{result && <div className={result.matched ? 'friend-add-editor-testSuccess' : 'friend-add-editor-error'}><strong>{result.matched ? 'この設定が選ばれます' : '条件を確認してください'}</strong>{result.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}</Section></>
}

function Summary({ step, rule, definition, options, matchedLast28Days, pendingAction }: { step: Step; rule: EditorRule; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions; matchedLast28Days: number | null; pendingAction: boolean }) {
  const scenario = options.scenarios.find((item) => item.id === definition.scenarioId)?.name
  if (step === 'message') return <aside className={'friend-add-editor-summaryColumn'}><div className={'friend-add-editor-linePreview'}><strong>LINEプレビュー</strong><small>{definition.timing === 'immediate' ? '登録直後に届きます' : 'シナリオの時刻に従って届きます'}</small><p>{definition.messageText || scenario || '最初に送る内容が未設定です。'}</p></div><div className={'friend-add-editor-summary'}><h2>設定サマリー</h2><span>配信</span><strong>{MESSAGE_TYPE_LABEL[definition.messageType]}</strong><span>送信タイミング</span><strong>{definition.timing === 'immediate' ? '登録直後' : 'シナリオ時刻'}</strong><span>アクション</span><strong>{definition.actions.length ? `設定済み ${definition.actions.length}件` : 'なし'}</strong><span>経路不明時</span><strong>{unknownRouteSummary(definition)}</strong></div></aside>
  return <aside className={'friend-add-editor-summaryColumn'}><div className={'friend-add-editor-summary'}><h2>{step === 'routes' ? '判定サマリー' : '設定サマリー'}</h2>{step === 'preview' ? <><span>所要時間</span><strong>数秒</strong><span>本番影響</span><strong>なし</strong><span>送信数</span><strong>0通（実際には送信しません）</strong><span>アクション</span><strong>{definition.actions.length ? `設定済み${definition.actions.length}件・テストでは実行しません` : 'なし'}</strong></> : step === 'actions' ? <><span>実行数</span><strong>{definition.actions.length + (pendingAction ? 1 : 0)}件</strong><span>対象</span><strong>{rule.friendKind === 'returning' ? '以前からの友だち・ブロック解除' : 'はじめての追加'}</strong><span>失敗時</span><strong>要対応へ追加</strong></> : step === 'routes' ? <><span>流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>登録日時</span><strong>{timeWindowsSummary(definition.timeWindows)}</strong><span>友だち条件</span><strong>{friendConditionSummary(definition.friendCondition ?? '')}</strong><span>過去28日の該当</span><strong>{matchedLast28Days === null ? '未取得' : `${matchedLast28Days}人`}</strong></> : <><span>状態</span><strong>{rule.status === 'published' ? '有効' : rule.status === 'stopped' ? '停止中' : '下書き'}</strong><span>設定名</span><strong>{rule.name || '未入力'}</strong><span>対象の流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>直近7日の追加</span><strong>{rule.matchedLast7Days === null ? '未取得' : `${rule.matchedLast7Days}人`}</strong><span>二重送信防止</span><strong>{resendSuppressionText(definition.resendSuppressionHours)}</strong><span>テスト</span><strong>{rule.lastTestStatus === 'succeeded' ? '成功' : rule.lastTestStatus === 'failed' ? '失敗' : '未実施'}</strong><span>配信</span><strong>{definition.messageText ? 'テキストメッセージ' : scenario || '未設定'}</strong><span>アクション</span><strong>{definition.actions.length}件</strong></>}</div><div className={'friend-add-editor-linePreview'}><strong>LINEプレビュー</strong><small>◷ 実際のLINE表示に近いプレビューです</small><p>{definition.messageText || scenario || '最初に送る内容が未設定です。'}</p></div></aside>
}

function unknownRouteSummary(definition: FriendAddRuleDefinition) {
  return definition.unknownRouteAction?.sendCommonGuidance === false ? '何もしない' : '質問'
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2><p className={'friend-add-editor-description'}>{description}</p><div className={'friend-add-editor-sectionBody'}>{children}</div></section>
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className={'friend-add-editor-field'}><span>{label}{required && <RequiredBadge />}</span>{children}</label>
}
