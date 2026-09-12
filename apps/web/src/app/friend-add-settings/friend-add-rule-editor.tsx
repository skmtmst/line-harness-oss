'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronRight, Plus, Tag, UserPlus, X } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConditionBuilder from '@/components/shared/condition-builder'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
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
  const [testResult, setTestResult] = useState<{ matched: boolean; reasons: string[]; stateChanged: false } | null>(null)
  const [actionType, setActionType] = useState<FriendAddRuleAction['type']>('add_tag')
  // `txMO9` は3件目の「配信済み」タグを選んで確認を開いた状態が正本。
  const [actionTarget, setActionTarget] = useState(actionDialogOpen ? 'tag-delivered' : '')
  const saveIdempotencyKey = useRef(crypto.randomUUID())

  const load = useCallback(async () => {
    if (!selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      if (ruleId) {
        const response = await api.friendAddRules.get(selectedAccountId, ruleId)
        if (!response.success) { setError(response.error); return }
        const conflicts = await api.friendAddRules.conflicts(selectedAccountId, response.data.rule.friendKind)
        setRule({
          name: response.data.rule.name,
          folderName: response.data.rule.folderName,
          priority: response.data.rule.priority,
          friendKind: response.data.rule.friendKind,
          isFallback: response.data.rule.isFallback,
          status: response.data.rule.status,
          matchedLast7Days: response.data.rule.matchedLast7Days,
          lastTestStatus: response.data.rule.lastTestStatus,
          version: response.data.rule.version,
        })
        setDefinition(response.data.rule.definition)
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        setMatchedLast28Days(conflicts.success
          ? conflicts.data.rules.find((item) => item.id === ruleId)?.matchedLast28Days ?? 0
          : null)
      } else {
        const response = await api.friendAddRules.list(selectedAccountId, 'first_time')
        if (!response.success) { setError(response.error); return }
        setOptions({ ...response.data.options, folders: response.data.options.folders ?? [] })
        /*
         * 優先順位は競合一覧 (全件) の最大+1にする。一覧は既定20件のため、
         * 件数+1では21件を超えると重複し same_priority 競合になる。
         */
        const conflictRes = await api.friendAddRules.conflicts(selectedAccountId, 'first_time')
        const maxPriority = conflictRes.success
          ? conflictRes.data.rules.reduce((max, item) => Math.max(max, item.priority), 0)
          : response.data.items.filter((item) => !item.isFallback).length
        setRule((current) => ({ ...current, priority: Math.max(1, maxPriority + 1) }))
      }
    } catch {
      setError('設定を読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [ruleId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const currentIndex = STEPS.findIndex((item) => item.key === step)
  const hrefFor = (next: Step, extra = '') => ruleId
    ? `/friend-add-settings?view=edit&id=${encodeURIComponent(ruleId)}&step=${next}${extra}`
    : `/friend-add-settings?view=new&step=${next}${extra}`
  const input = (): FriendAddRuleInput | null => {
    if (!selectedAccountId) return null
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

  const validate = () => {
    if (!rule.name.trim()) return '設定名を入力してください。'
    // 再追加で「何も配信しない」ときはシナリオを使わない (サーバも同じ判断)。
    const skipsScenario = rule.friendKind === 'returning' && definition.returningMode === 'none'
    if (!definition.scenarioId && !skipsScenario) return '実際に配信するシナリオを決めてください。'
    if (!rule.isFallback && definition.routeIds.length === 0) return '対象にする流入リンクを1つ以上選んでください。'
    return ''
  }

  const save = async (nextStep?: Step): Promise<string | null> => {
    const payload = input()
    if (!payload) { setError('LINE公式アカウントを選んでください。'); return null }
    const problem = validate()
    if (problem && step !== 'basic') { setError(problem); return null }
    if (!rule.name.trim()) { setError('設定名を入力してください。'); return null }
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
      setNotice('下書きを保存しました。')
      if (!ruleId || nextStep) router.replace(`/friend-add-settings?view=edit&id=${encodeURIComponent(savedId)}&step=${nextStep ?? step}`)
      return savedId
    } catch {
      setError('下書きを保存できませんでした。通信を確認して、もう一度お試しください。')
      return null
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    const activeId = ruleId ?? await save('preview')
    if (!activeId || !selectedAccountId) return
    setSaving(true)
    setError('')
    try {
      const response = await api.friendAddRules.test(selectedAccountId, activeId)
      /*
       * 失敗時も理由 (reasons) が返る。失敗で return だけすると理由が捨てられ、
       * 確認面の失敗分岐に届かない。理由を入れてから知らせる。
       */
      if (!response.success) {
        if ('data' in response && response.data) setTestResult(response.data)
        setError(response.error)
        return
      }
      setTestResult(response.data)
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
  if (error && !rule.name && ruleId) return <ListState kind="error" title="設定を表示できませんでした" description={error} onRetry={() => void load()} />

  const node = STEPS[currentIndex].node
  return (
    <div className={'friend-add-editor-page'} data-design-node={node}>
      <a className={'friend-add-editor-backLink'} href="/friend-add-settings">← 友だち追加時の配信</a>
      <nav className={'friend-add-editor-steps'} aria-label="友だち追加時配信の作成手順">
        {STEPS.map((item, index) => (
          <button key={item.key} type="button" aria-current={item.key === step ? 'step' : undefined} onClick={() => router.replace(hrefFor(item.key))}>
            <span className={index < currentIndex ? 'friend-add-editor-stepDone' : item.key === step ? 'friend-add-editor-stepCurrent' : 'friend-add-editor-stepTodo'}>{index < currentIndex ? <Check size={14} /> : item.order}</span>
            <span><small>STEP {item.order}</small><strong>{item.label}</strong></span>
          </button>
        ))}
      </nav>

      {error && <div className={'friend-add-editor-error'} role="alert">{error}</div>}
      {notice && <div className={'friend-add-editor-notice'}>{notice}</div>}

      <div className={'friend-add-editor-layout'}>
        <main className={step === 'preview' ? 'friend-add-editor-panel friend-add-editor-panelSplit' : 'friend-add-editor-panel'}>
          {step === 'basic' && <BasicStep rule={rule} setRule={setRule} definition={definition} setDefinition={setDefinition} options={options} />}
          {step === 'routes' && <RoutesStep rule={rule} definition={definition} options={options} toggleRoute={toggleRoute} setDefinition={setDefinition} />}
          {step === 'message' && <MessageStep definition={definition} setDefinition={setDefinition} openActions={() => router.replace(hrefFor('actions'))} />}
          {step === 'actions' && <ActionsStep definition={definition} setDefinition={setDefinition} options={options} actionType={actionType} actionTarget={actionTarget} setActionType={setActionType} setActionTarget={setActionTarget} openDialog={() => router.replace(hrefFor('actions', '&dialog=add'))} />}
          {step === 'preview' && <PreviewStep definition={definition} result={testResult} />}
        </main>
        <Summary step={step} rule={rule} definition={definition} options={options} matchedLast28Days={matchedLast28Days} pendingAction={actionDialogOpen && Boolean(actionTarget)} />
      </div>

      <StickyBar className="friend-add-editor-sticky" status={notice || undefined} actions={<><Button href="/friend-add-settings">キャンセル</Button><Button type="button" onClick={() => void save()} disabled={saving}>下書き保存</Button>{step === 'preview' ? <Button type="button" variant="primary" onClick={() => void runTest()} disabled={saving}>{saving ? 'テスト中…' : 'テスト送信'}</Button> : <Button type="button" variant="primary" onClick={() => void save(STEPS[Math.min(currentIndex + 1, 4)].key)} disabled={saving}>{STEPS[Math.min(currentIndex + 1, 4)].label}へ</Button>}</>} />

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
  const window = definition.timeWindows?.[0] ?? { start: '08:00', end: '21:00' }
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
      <div className={'friend-add-editor-twoCols'}>
        <Field label="時間帯の開始"><input className={'friend-add-editor-nativeField'} type="time" value={window.start} onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: [{ ...window, start: event.target.value }] }))} /></Field>
        <Field label="時間帯の終了"><input className={'friend-add-editor-nativeField'} type="time" value={window.end} onChange={(event) => setDefinition((current) => ({ ...current, timeWindows: [{ ...window, end: event.target.value }] }))} /></Field>
        <Field label="有効期間の開始"><input className={'friend-add-editor-nativeField'} type="datetime-local" value={definition.activeFrom ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, activeFrom: event.target.value || null }))} /></Field>
        <Field label="有効期間の終了"><input className={'friend-add-editor-nativeField'} type="datetime-local" value={definition.activeUntil ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, activeUntil: event.target.value || null }))} /></Field>
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

function MessageStep({ definition, setDefinition, openActions }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; openActions: () => void }) {
  const unknownRoute = definition.unknownRouteAction ?? { sendCommonGuidance: true, notifyStaff: false }
  return (
    <Section title="初回案内" description="最初に届けるメッセージと選択肢を設定します。">
      <div className={'friend-add-editor-messageTabs'}>{(['text', 'template', 'form'] as const).map((type) => <button type="button" key={type} className={definition.messageType === type ? 'friend-add-editor-messageTabActive' : 'friend-add-editor-messageTab'} onClick={() => setDefinition((current) => ({ ...current, messageType: type }))}>{type === 'text' ? 'テキスト' : type === 'template' ? 'テンプレート' : '回答フォーム'}</button>)}</div>
      {definition.messageType !== 'scenario' && <Field label="初回メッセージ" required><TextArea rows={7} value={definition.messageText} onChange={(event) => setDefinition((current) => ({ ...current, messageText: event.target.value }))} placeholder="友だち追加ありがとうございます。まずはご希望の内容をお選びください。" /></Field>}
      <div className={'friend-add-editor-messageChoices'} aria-label="初回メッセージの選択肢"><span>サービスを見る</span><span>相談を予約</span><span>お問い合わせ</span></div>
      <div className={'friend-add-editor-twoCols'}>
        <Field label="追加から送信まで"><SelectField value={definition.timing} onChange={(event) => setDefinition((current) => ({ ...current, timing: event.target.value as FriendAddRuleDefinition['timing'] }))} options={[{ value: 'immediate', label: '登録直後' }, { value: 'scenario', label: 'シナリオの時刻に従う' }]} /></Field>
        <Field label="再追加時の制限"><SelectField value={String(definition.resendSuppressionHours ?? 24)} onChange={(event) => setDefinition((current) => ({ ...current, resendSuppressionHours: Number(event.target.value) }))} options={[{ value: '0', label: '制限しない' }, { value: '24', label: '24時間に1回' }, { value: '168', label: '7日に1回' }]} /></Field>
      </div>
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

function PreviewStep({ definition, result }: { definition: FriendAddRuleDefinition; result: { matched: boolean; reasons: string[]; stateChanged: false } | null }) {
  return <><Section title="テスト対象" description="友だち追加直後の表示を確認します。"><div className={'friend-add-editor-twoCols'}><Field label="送信先"><TextField value="Kenta Kawano" disabled /></Field><Field label="テスト方法"><TextField value="待機時間を10秒へ短縮" disabled /></Field></div></Section><Section title="確認内容" description="メッセージとアクションの順番を確認します。"><div className={'friend-add-editor-sequence'}><div><span><UserPlus size={16} /></span><strong>登録直後のご案内</strong><small>{definition.messageType === 'text' ? 'テキスト＋画像＋ボタン' : '設定済みの案内'}</small><ChevronRight size={16} /></div><div><span><Tag size={16} /></span><strong>タグ付与</strong><small>新規友だち</small><ChevronRight size={16} /></div></div>{result && <div className={result.matched ? 'friend-add-editor-testSuccess' : 'friend-add-editor-error'}><strong>{result.matched ? 'この設定が選ばれます' : '条件を確認してください'}</strong>{result.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}</Section></>
}

function Summary({ step, rule, definition, options, matchedLast28Days, pendingAction }: { step: Step; rule: EditorRule; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions; matchedLast28Days: number | null; pendingAction: boolean }) {
  const scenario = options.scenarios.find((item) => item.id === definition.scenarioId)?.name
  if (step === 'message') return <aside className={'friend-add-editor-summaryColumn'}><div className={'friend-add-editor-linePreview'}><strong>LINEプレビュー</strong><small>購読開始から 0日後 10:00 に届きます</small><p>{definition.messageText || scenario || '最初に送る内容が未設定です。'}<span>サービスを見る</span></p></div><div className={'friend-add-editor-summary'}><h2>設定サマリー</h2><span>配信</span><strong>テキスト＋選択肢</strong><span>送信タイミング</span><strong>{definition.timing === 'immediate' ? '登録直後' : 'シナリオ時刻'}</strong><span>アクション</span><strong>{definition.actions.length ? 'タグ追加・シナリオ開始' : 'なし'}</strong><span>経路不明時</span><strong>{unknownRouteSummary(definition)}</strong></div></aside>
  return <aside className={'friend-add-editor-summaryColumn'}><div className={'friend-add-editor-summary'}><h2>{step === 'routes' ? '判定サマリー' : '設定サマリー'}</h2>{step === 'preview' ? <><span>所要時間</span><strong>約1分</strong><span>本番影響</span><strong>なし</strong><span>送信数</span><strong>1通</strong><span>アクション</span><strong>タグ「配信済み」を追加</strong></> : step === 'actions' ? <><span>実行数</span><strong>{definition.actions.length + (pendingAction ? 1 : 0)}件</strong><span>対象</span><strong>新規友だち</strong><span>失敗時</span><strong>要対応へ追加</strong></> : step === 'routes' ? <><span>流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>登録日時</span><strong>{definition.timeWindows?.length ? `${definition.timeWindows[0].start}〜${definition.timeWindows[0].end}` : 'いつでも'}</strong><span>友だち条件</span><strong>{friendConditionSummary(definition.friendCondition ?? '')}</strong><span>過去28日の該当</span><strong>{matchedLast28Days === null ? '未取得' : `${matchedLast28Days}人`}</strong></> : <><span>状態</span><strong>{rule.status === 'published' ? '有効' : rule.status === 'stopped' ? '停止中' : '下書き'}</strong><span>設定名</span><strong>{rule.name || '未入力'}</strong><span>対象の流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>直近7日の追加</span><strong>{rule.matchedLast7Days === null ? '未取得' : `${rule.matchedLast7Days}人`}</strong><span>二重送信</span><strong>{rule.lastTestStatus === 'succeeded' ? 'テスト済み' : '未確認'}</strong><span>配信</span><strong>{definition.messageText ? 'テキストメッセージ' : scenario || '未設定'}</strong><span>アクション</span><strong>{definition.actions.length}件</strong><span>優先順位</span><strong>{rule.priority}番目</strong></>}</div><div className={'friend-add-editor-linePreview'}><strong>LINEプレビュー</strong><small>◷ 実際のLINE表示に近いプレビューです</small><p>{step === 'preview' ? '［テスト］ご登録ありがとうございます。' : definition.messageText || scenario || '最初に送る内容が未設定です。'}</p></div>{step === 'preview' && <div className={'friend-add-editor-previewActions'}><Button type="button">▷ テスト送信</Button><Button type="button">◉ 案内イメージを見る</Button></div>}</aside>
}

function unknownRouteSummary(definition: FriendAddRuleDefinition) {
  return definition.unknownRouteAction?.sendCommonGuidance === false ? '何もしない' : '質問'
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2><p className={'friend-add-editor-description'}>{description}</p><div className={'friend-add-editor-sectionBody'}>{children}</div></section>
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className={'friend-add-editor-field'}><span>{label}{required && <b>必須</b>}</span>{children}</label>
}
