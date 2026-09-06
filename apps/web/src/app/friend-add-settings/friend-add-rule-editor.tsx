'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Plus, X } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
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
import { api } from '@/lib/api'
import './friend-add-rule-editor.css'

type Step = 'basic' | 'routes' | 'message' | 'actions' | 'preview'
type EditorRule = Pick<FriendAddRule, 'name' | 'folderName' | 'priority' | 'friendKind' | 'isFallback' | 'status' | 'matchedLast7Days' | 'lastTestStatus'>
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
  activeFrom: null,
  activeUntil: null,
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
    status: 'draft', matchedLast7Days: null, lastTestStatus: null,
  })
  const [definition, setDefinition] = useState<FriendAddRuleDefinition>(EMPTY_DEFINITION)
  const [options, setOptions] = useState<FriendAddRuleOptions>({ routes: [], scenarios: [], tags: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testResult, setTestResult] = useState<{ matched: boolean; reasons: string[]; stateChanged: false } | null>(null)
  const [actionType, setActionType] = useState<FriendAddRuleAction['type']>('add_tag')
  const [actionTarget, setActionTarget] = useState('')
  const saveIdempotencyKey = useRef(crypto.randomUUID())

  const load = useCallback(async () => {
    if (!selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      if (ruleId) {
        const response = await api.friendAddRules.get(selectedAccountId, ruleId)
        if (!response.success) { setError(response.error); return }
        setRule({
          name: response.data.rule.name,
          folderName: response.data.rule.folderName,
          priority: response.data.rule.priority,
          friendKind: response.data.rule.friendKind,
          isFallback: response.data.rule.isFallback,
          status: response.data.rule.status,
          matchedLast7Days: response.data.rule.matchedLast7Days,
          lastTestStatus: response.data.rule.lastTestStatus,
        })
        setDefinition(response.data.rule.definition)
        setOptions(response.data.options)
      } else {
        const response = await api.friendAddRules.list(selectedAccountId, 'first_time')
        if (!response.success) { setError(response.error); return }
        setOptions(response.data.options)
        setRule((current) => ({ ...current, priority: Math.max(1, response.data.items.filter((item) => !item.isFallback).length + 1) }))
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
      definition,
    }
  }

  const validate = () => {
    if (!rule.name.trim()) return '設定名を入力してください。'
    if (!definition.scenarioId) return '実際に配信するシナリオを決めてください。'
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
      if (!response.success) { setError(response.error); return }
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
        <main className={'friend-add-editor-panel'}>
          {step === 'basic' && <BasicStep rule={rule} setRule={setRule} definition={definition} setDefinition={setDefinition} />}
          {step === 'routes' && <RoutesStep rule={rule} definition={definition} options={options} toggleRoute={toggleRoute} setDefinition={setDefinition} />}
          {step === 'message' && <MessageStep definition={definition} setDefinition={setDefinition} options={options} />}
          {step === 'actions' && <ActionsStep definition={definition} setDefinition={setDefinition} options={options} actionType={actionType} actionTarget={actionTarget} setActionType={setActionType} setActionTarget={setActionTarget} openDialog={() => router.replace(hrefFor('actions', '&dialog=add'))} />}
          {step === 'preview' && <PreviewStep definition={definition} result={testResult} />}
        </main>
        <Summary step={step} rule={rule} definition={definition} options={options} />
      </div>

      <StickyBar status={notice || undefined} actions={<><Button href="/friend-add-settings">キャンセル</Button><Button type="button" onClick={() => void save()} disabled={saving}>下書き保存</Button>{step === 'preview' ? <Button type="button" variant="primary" onClick={() => void runTest()} disabled={saving}>{saving ? 'テスト中…' : 'テスト送信'}</Button> : <Button type="button" variant="primary" onClick={() => void save(STEPS[Math.min(currentIndex + 1, 4)].key)} disabled={saving}>{STEPS[Math.min(currentIndex + 1, 4)].label}へ</Button>}</>} />

      {actionDialogOpen && (
        <div data-design-node="txMO9">
          <Dialog
            open
            title="アクションを追加"
            description={`選択した${definition.actions.length + 1}件のアクションを配信フローへ追加します。`}
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

function BasicStep({ rule, setRule, definition, setDefinition }: { rule: EditorRule; setRule: React.Dispatch<React.SetStateAction<EditorRule>>; definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>> }) {
  return <Section title="基本設定" description="管理名・フォルダ・優先順位を設定します。"><div className={'friend-add-editor-twoCols'}><Field label="設定名" required><TextField value={rule.name} maxLength={60} onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} /><small>{rule.name.length} / 60文字　友だちには表示されません</small></Field><Field label="フォルダ"><TextField value={rule.folderName ?? ''} placeholder="例: 店頭QR" onChange={(event) => setRule((current) => ({ ...current, folderName: event.target.value }))} /></Field><Field label="優先順位"><TextField type="number" min={1} value={rule.priority} onChange={(event) => setRule((current) => ({ ...current, priority: Math.max(1, Number(event.target.value) || 1) }))} /></Field><Field label="判定する人"><SelectField value={rule.friendKind} disabled={rule.isFallback} onChange={(event) => setRule((current) => ({ ...current, friendKind: event.target.value as FriendAddRuleKind }))} options={[{ value: 'first_time', label: 'はじめて友だち追加した人' }, { value: 'returning', label: '以前からの友だち・ブロック解除した人' }]} /></Field></div><Field label="社内メモ"><TextArea value={definition.friendCondition} onChange={(event) => setDefinition((current) => ({ ...current, friendCondition: event.target.value }))} placeholder="この設定を使う理由を残せます。" /></Field></Section>
}

function RoutesStep({ rule, definition, options, toggleRoute, setDefinition }: { rule: Pick<FriendAddRule, 'isFallback'>; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions; toggleRoute: (id: string) => void; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>> }) {
  return <Section title="どの流入から来た人か" description="「流入と計測」で作ったリンクから選びます。ここに無いものは、流入と計測で作成します。">{rule.isFallback ? <div className={'friend-add-editor-info'}>この設定は、流入経路を確定できなかった人へ最後に動きます。</div> : <div className={'friend-add-editor-routeList'}>{options.routes.map((route) => <label key={route.id} className={definition.routeIds.includes(route.id) ? 'friend-add-editor-routeSelected' : 'friend-add-editor-route'}><input type="checkbox" checked={definition.routeIds.includes(route.id)} onChange={() => toggleRoute(route.id)} /><span><strong>{route.name}</strong><small>{route.kind}・過去28日の追加人数は未取得</small></span></label>)}</div>}<div className={'friend-add-editor-twoCols'}><Field label="有効期間の開始"><input className={'friend-add-editor-nativeField'} type="datetime-local" value={definition.activeFrom ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, activeFrom: event.target.value || null }))} /></Field><Field label="有効期間の終了"><input className={'friend-add-editor-nativeField'} type="datetime-local" value={definition.activeUntil ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, activeUntil: event.target.value || null }))} /></Field></div><div className={'friend-add-editor-info'}><strong>曜日・時間帯・友だち条件</strong><br />保存先と過去28日の当たり具合を計算する口は未接続です。いま保存できる流入リンクと有効期間だけを使います。</div><p className={'friend-add-editor-helper'}>同じ友だちが複数の流入条件に当てはまったときは、優先順位の小さいものだけを実行します。</p></Section>
}

function MessageStep({ definition, setDefinition, options }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; options: FriendAddRuleOptions }) {
  return <Section title="初回案内" description="最初に届けるメッセージと後続のシナリオを設定します。"><div className={'friend-add-editor-messageTabs'}>{(['text', 'template', 'form', 'scenario'] as const).map((type) => <button type="button" key={type} className={definition.messageType === type ? 'friend-add-editor-messageTabActive' : 'friend-add-editor-messageTab'} onClick={() => setDefinition((current) => ({ ...current, messageType: type }))}>{type === 'text' ? 'テキスト' : type === 'template' ? 'テンプレート' : type === 'form' ? '回答フォーム' : 'シナリオ'}</button>)}</div>{definition.messageType !== 'scenario' && <Field label="初回メッセージ" required><TextArea rows={8} value={definition.messageText} onChange={(event) => setDefinition((current) => ({ ...current, messageText: event.target.value }))} placeholder="友だち追加ありがとうございます。まずはご希望の内容をお選びください。" /></Field>}<Field label="配信するシナリオ"><SelectField value={definition.scenarioId ?? ''} onChange={(event) => setDefinition((current) => ({ ...current, scenarioId: event.target.value || null }))} options={[{ value: '', label: '選んでください' }, ...options.scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]} /></Field><Field label="追加から送信まで"><SelectField value={definition.timing} onChange={(event) => setDefinition((current) => ({ ...current, timing: event.target.value as FriendAddRuleDefinition['timing'] }))} options={[{ value: 'immediate', label: '登録直後' }, { value: 'scenario', label: 'シナリオの時刻に従う' }]} /></Field><div className={'friend-add-editor-info'}><strong>再追加時の制限・経路不明時の動作</strong><br />24時間の再送制限と、共通案内／担当者通知を選ぶ保存先は未接続です。接続までは現在の公開ルールを変えません。</div></Section>
}

function ActionsStep({ definition, setDefinition, options, actionType, actionTarget, setActionType, setActionTarget, openDialog }: { definition: FriendAddRuleDefinition; setDefinition: React.Dispatch<React.SetStateAction<FriendAddRuleDefinition>>; options: FriendAddRuleOptions; actionType: FriendAddRuleAction['type']; actionTarget: string; setActionType: (value: FriendAddRuleAction['type']) => void; setActionTarget: (value: string) => void; openDialog: () => void }) {
  return <Section title="アクションの種類" description="友だち追加後に自動実行する内容を選びます。"><div className={'friend-add-editor-twoCols'}><Field label="アクション"><SelectField value={actionType} onChange={(event) => { setActionType(event.target.value as FriendAddRuleAction['type']); setActionTarget('') }} options={[{ value: 'add_tag', label: 'タグを付与' }, { value: 'remove_tag', label: 'タグを解除' }, { value: 'start_scenario', label: 'シナリオを開始' }]} /></Field><Field label="実行タイミング"><TextField value="登録直後" disabled /></Field></div><Field label="設定内容"><SelectField value={actionTarget} onChange={(event) => setActionTarget(event.target.value)} options={[{ value: '', label: '選んでください' }, ...(actionType === 'start_scenario' ? options.scenarios : options.tags).map((item) => ({ value: item.id, label: item.name }))]} /></Field><div className={'friend-add-editor-actionList'}>{definition.actions.length === 0 ? <p>追加のアクションはありません。</p> : definition.actions.map((action, index) => <div key={`${action.type}-${index}`}><span>{index + 1}</span><strong>{action.label}</strong><IconButton aria-label={`${action.label}を外す`} onClick={() => setDefinition((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))}><X size={16} /></IconButton></div>)}</div><Button type="button" variant="primary" onClick={openDialog} disabled={!actionTarget}><Plus size={16} />アクションを追加</Button></Section>
}

function PreviewStep({ definition, result }: { definition: FriendAddRuleDefinition; result: { matched: boolean; reasons: string[]; stateChanged: false } | null }) {
  return <><Section title="テスト対象" description="友だち追加直後の表示を確認します。"><div className={'friend-add-editor-twoCols'}><Field label="送信先"><TextField value="画面確認" disabled /></Field><Field label="テスト方法"><TextField value="待機時間を10秒へ短縮" disabled /></Field></div></Section><Section title="確認内容" description="メッセージとアクションの順番を確認します。"><div className={'friend-add-editor-sequence'}><div><span>1</span><strong>登録直後のご案内</strong><small>{definition.messageType === 'text' ? 'テキストメッセージ' : '設定済みの案内'}</small></div><div><span>2</span><strong>あわせて行うこと</strong><small>{definition.actions.length ? definition.actions.map((action) => action.label).join('／') : '追加のアクションはありません'}</small></div></div>{result && <div className={result.matched ? 'friend-add-editor-testSuccess' : 'friend-add-editor-error'}><strong>{result.matched ? 'この設定が選ばれます' : '条件を確認してください'}</strong>{result.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}<p className={'friend-add-editor-helper'}>テストは本番の登録、送信、タグ、マイル、回数を更新しません。</p></Section></>
}

function Summary({ step, rule, definition, options }: { step: Step; rule: EditorRule; definition: FriendAddRuleDefinition; options: FriendAddRuleOptions }) {
  const scenario = options.scenarios.find((item) => item.id === definition.scenarioId)?.name
  return <aside className={'friend-add-editor-summaryColumn'}><div className={'friend-add-editor-summary'}><h2>{step === 'routes' ? '判定サマリー' : '設定サマリー'}</h2>{step === 'preview' ? <><span>所要時間</span><strong>約1分</strong><span>本番影響</span><strong>なし</strong><span>送信数</span><strong>1通</strong><span>アクション</span><strong>{definition.actions.length}件</strong></> : step === 'actions' ? <><span>実行数</span><strong>{definition.actions.length}件</strong><span>対象</span><strong>新規友だち</strong><span>失敗時</span><strong>要対応へ追加</strong></> : step === 'routes' ? <><span>流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>登録日時</span><strong>{definition.activeFrom || definition.activeUntil ? '期間指定あり' : 'いつでも'}</strong><span>友だち条件</span><strong>{definition.friendCondition || '未設定'}</strong><span>過去28日の該当</span><strong>未取得</strong></> : <><span>状態</span><strong>{rule.status === 'published' ? '有効' : rule.status === 'stopped' ? '停止中' : '下書き'}</strong><span>設定名</span><strong>{rule.name || '未入力'}</strong><span>対象の流入リンク</span><strong>{definition.routeIds.length ? `${definition.routeIds.length}件を選択` : '未選択'}</strong><span>直近7日の追加</span><strong>{rule.matchedLast7Days === null ? '未取得' : `${rule.matchedLast7Days}人`}</strong><span>二重送信</span><strong>{rule.lastTestStatus === 'succeeded' ? 'テスト済み' : '未確認'}</strong><span>配信</span><strong>{definition.messageText ? 'テキストメッセージ' : scenario || '未設定'}</strong><span>アクション</span><strong>{definition.actions.length}件</strong><span>優先順位</span><strong>{rule.priority}番目</strong></>}</div><div className={'friend-add-editor-linePreview'}><strong>LINEプレビュー</strong><small>実際のLINE表示に近いプレビューです</small><p>{step === 'preview' ? '［テスト］' : ''}{definition.messageText || scenario || '最初に送る内容が未設定です。'}</p></div></aside>
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2><p className={'friend-add-editor-description'}>{description}</p><div className={'friend-add-editor-sectionBody'}>{children}</div></section>
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className={'friend-add-editor-field'}><span>{label}{required && <b>必須</b>}</span>{children}</label>
}
