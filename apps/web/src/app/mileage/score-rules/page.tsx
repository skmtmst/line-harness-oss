'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, CalendarCheck, Clock3, ClipboardList, EyeOff, MailX, MessageCircle, MousePointerClick, Pencil, Plus, RefreshCw, ShoppingBag, Trash2, WalletCards } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Field, TextInput } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  type ActionScoreBands,
  type ActionScoreFrequencyKind,
  type ActionScoreRule,
  type ActionScoreRuleBundle,
  type ActionScoreRuleConfiguration,
  type ActionScoreRuleTestResult,
} from '@/lib/api'
import { localDateTime, utcDateTime } from '@/lib/presentation'

type ConfirmAction = { kind: 'publish'; draftVersionId: string } | { kind: 'stop' } | null

const EVENT_OPTIONS = [
  { value: 'message_received|line_webhook', label: 'メッセージに返信した' },
  { value: 'link_clicked|tracked_link', label: '配信のURLを押した' },
  { value: 'form_submitted|form', label: '回答フォームに答えた' },
  { value: 'booking_created|', label: '予約した' },
  { value: 'purchase_completed|stripe', label: '購入した' },
  { value: 'inactivity_30d|scheduler', label: '30日間反応がない' },
  { value: 'friend_unfollow|line_webhook', label: 'ブロックした' },
] as const

const FREQUENCY_OPTIONS: Array<{ value: ActionScoreFrequencyKind; label: string }> = [
  { value: 'unlimited', label: '行動するたび' },
  { value: 'per_day', label: '1日ごと' },
  { value: 'per_subject', label: '同じ対象ごと' },
  { value: 'per_subject_per_day', label: '同じ対象・1日ごと' },
  { value: 'once_per_period', label: '同じ期間に1回' },
]

function eventValue(rule: ActionScoreRule) {
  return `${rule.eventType}|${rule.source ?? ''}`
}

function operationValue(rule: ActionScoreRule) {
  if (rule.operation === 'set') return 'set-zero'
  return rule.value < 0 ? 'subtract' : 'add'
}

function rulePointLabel(rule: ActionScoreRule) {
  if (rule.operation === 'set') return '0にする'
  return `${rule.value > 0 ? '+' : '−'}${Math.abs(rule.value)}`
}

function ruleFrequencyLabel(rule: ActionScoreRule) {
  const label = FREQUENCY_OPTIONS.find((option) => option.value === rule.frequency.kind)?.label ?? '回数未設定'
  if (!['per_day', 'per_subject', 'per_subject_per_day'].includes(rule.frequency.kind)) return label
  return rule.frequency.limit === 1 ? `${label.replace('ごと', '')}に1回まで` : `${label} ${rule.frequency.limit}回まで`
}

function RuleIcon({ eventType }: { eventType: string }) {
  if (eventType === 'link_clicked') return <MousePointerClick className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'message_received') return <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'form_submitted') return <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'booking_created') return <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'purchase_completed') return <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'inactivity_30d') return <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
  return <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
}

function cloneBundle(config: ActionScoreRuleConfiguration): ActionScoreRuleBundle {
  return {
    rules: config.editableVersion.rules.map((rule) => ({ ...rule, frequency: { ...rule.frequency } })),
    bands: { ...config.editableVersion.bands },
  }
}

/*
 * 失敗の理由を、そのまま出してよいものだけ通す。
 *
 * `ApiError` の `message` は 400 以外だと `API error: <番号>` に落ちる
 * （`lib/api.ts`）。素通しすると **`API error: 405` が利用者に見える。**
 * 同じ機能の手動マイル調整（`mileage/friends/detail/mileage-adjustment-dialog.tsx`）
 * と同じ形にそろえた。
 */
function fieldError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message
    if (error.status === 403) return 'スコアのルールを変更する権限がありません。'
    if (error.status === 404) return '対象のLINEアカウントを確認できませんでした。'
    if (error.status === 405) return 'この環境ではスコアのルールを変更できません。'
    if (error.status === 409) return 'ほかの人が先に保存しています。画面を読み直してからやり直してください。'
    return 'スコアのルールを処理できませんでした。時間をおいてもう一度お試しください。'
  }
  return error instanceof Error
    ? '通信に失敗しました。接続を確認してもう一度お試しください。'
    : 'スコアのルールを処理できませんでした。もう一度お試しください。'
}

export default function ActionScoreRulesPage() {
  usePageTitle('スコアのルール')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [configuration, setConfiguration] = useState<ActionScoreRuleConfiguration | null>(null)
  const [bundle, setBundle] = useState<ActionScoreRuleBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [editRuleIndex, setEditRuleIndex] = useState<number | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testScore, setTestScore] = useState('30')
  const [testEvent, setTestEvent] = useState<string>(EVENT_OPTIONS[0].value)
  const [testResult, setTestResult] = useState<ActionScoreRuleTestResult | null>(null)

  useEffect(() => {
    try {
      const role = localStorage.getItem('lh_staff_role')
      setCanEdit(role === 'owner' || role === 'admin')
    } catch {
      setCanEdit(false)
    }
  }, [])

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setConfiguration(null)
      setBundle(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setForbidden(false)
    setLoadError('')
    try {
      const response = await api.actionScores.rules(accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setConfiguration(response.data)
      setBundle(cloneBundle(response.data))
      setTestScore(String(response.data.editableVersion.bands.normalMin))
    } catch (error) {
      if (accountAtRequest !== latestAccountRef.current) return
      setConfiguration(null)
      setBundle(null)
      if (error instanceof ApiError && error.status === 403) setForbidden(true)
      else setLoadError('スコアのルールを読み込めませんでした。')
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => void load(), [load])

  const updateRule = (index: number, updates: Partial<ActionScoreRule>) => {
    setNotice('')
    setTestResult(null)
    setBundle((current) => current ? {
      ...current,
      rules: current.rules.map((rule, position) => position === index
        ? { ...rule, ...updates, frequency: updates.frequency ? { ...updates.frequency } : rule.frequency }
        : rule),
    } : current)
  }

  const updateBands = (updates: Partial<ActionScoreBands>) => {
    setNotice('')
    setTestResult(null)
    setBundle((current) => current ? { ...current, bands: { ...current.bands, ...updates } } : current)
  }

  const addRule = () => {
    if (!bundle) return
    const id = `rule-${crypto.randomUUID()}`
    const nextIndex = bundle.rules.length
    setBundle({
      ...bundle,
      rules: [...bundle.rules, {
        id,
        name: '新しいルール',
        eventType: 'message_received',
        source: 'line_webhook',
        operation: 'delta',
        value: 1,
        frequency: { kind: 'per_day', limit: 1 },
        sameSourceEventOnce: true,
        validFrom: null,
        validUntil: null,
        enabled: true,
      }],
    })
    setEditRuleIndex(nextIndex)
    setNotice('')
  }

  const removeRule = (index: number) => {
    setBundle((current) => current ? {
      ...current,
      rules: current.rules.filter((_, position) => position !== index),
    } : current)
    setNotice('')
  }

  const saveDraft = async () => {
    if (!selectedAccountId || !bundle) return null
    const accountAtRequest = selectedAccountId
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const response = await api.actionScores.saveDraft({
        accountId: accountAtRequest,
        expectedDraftVersionId: configuration?.currentDraftVersionId ?? null,
        configuration: bundle,
      })
      if (accountAtRequest !== latestAccountRef.current) return null
      if (!response.success) throw new Error(response.error)
      setConfiguration(response.data)
      setBundle(cloneBundle(response.data))
      setNotice(`下書き（第${response.data.editableVersion.versionNumber}版）を保存しました。`)
      return response.data
    } catch (error) {
      setActionError(fieldError(error))
      return null
    } finally {
      setBusy(false)
    }
  }

  const preparePublish = async () => {
    const saved = await saveDraft()
    if (saved?.currentDraftVersionId) {
      setConfirmAction({ kind: 'publish', draftVersionId: saved.currentDraftVersionId })
    }
  }

  const publish = async (draftVersionId: string) => {
    if (!selectedAccountId) return
    const accountAtRequest = selectedAccountId
    setBusy(true)
    setActionError('')
    try {
      const response = await api.actionScores.publishRules({ accountId: accountAtRequest, draftVersionId })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setConfiguration(response.data)
      setBundle(cloneBundle(response.data))
      setConfirmAction(null)
      setNotice(`第${response.data.publishedVersion?.versionNumber ?? '—'}版を公開しました。利用先は公開した版に固定されます。`)
    } catch (error) {
      setActionError(fieldError(error))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!selectedAccountId) return
    const accountAtRequest = selectedAccountId
    setBusy(true)
    setActionError('')
    try {
      const response = await api.actionScores.stopRules(accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setConfiguration(response.data)
      setBundle(cloneBundle(response.data))
      setConfirmAction(null)
      setNotice('公開中のルールを止めました。過去の点数と履歴は残ります。')
    } catch (error) {
      setActionError(fieldError(error))
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    if (!selectedAccountId || !bundle) return
    const accountAtRequest = selectedAccountId
    const [eventType, source] = testEvent.split('|')
    setBusy(true)
    setActionError('')
    setTestResult(null)
    try {
      const response = await api.actionScores.testRules({
        accountId: accountAtRequest,
        configuration: bundle,
        currentScore: Number(testScore),
        eventType,
        source: source || null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setTestResult(response.data)
    } catch (error) {
      setActionError(fieldError(error))
    } finally {
      setBusy(false)
    }
  }

  const versionLabel = useMemo(() => {
    if (!configuration) return '未取得'
    if (configuration.status === 'not_configured') return 'まだ公開していません'
    if (configuration.status === 'stopped') return `第${configuration.publishedVersion?.versionNumber ?? '—'}版を停止中`
    if (configuration.status === 'published') return `第${configuration.publishedVersion?.versionNumber ?? '—'}版を公開中`
    return `第${configuration.editableVersion.versionNumber}版を編集中`
  }, [configuration])

  return (
    <main data-design-node="s6MBc" className="flex flex-col gap-3.5" style={{ minHeight: 'calc(100vh - 98px)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb items={[{ label: 'マイル', href: '/mileage' }, { label: '行動スコア', href: '/mileage?tab=score' }, { label: 'ルール' }]} />
        <Button onClick={() => setTestOpen(true)}>1人で試す</Button>
      </div>
      {!selectedAccountId && !accountLoading ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="スコアのルールは、共通トップバーで選んだLINEアカウントごとに保存します。" />
      ) : loading || accountLoading ? (
        <ListState kind="loading" title="スコアのルールを読み込んでいます" description="下書きと公開中の版を確認しています。" />
      ) : forbidden ? (
        <ListState kind="forbidden" />
      ) : loadError ? (
        <ListState kind="error" title="スコアのルールを表示できませんでした" description="再読み込みしても直らない場合はエラー報告へ。" action={<Button onClick={() => void load()}>スコアのルールを再読み込み</Button>} />
      ) : bundle && configuration ? <>
        <div className="grid gap-3 2xl:grid-cols-4">
          <div className="grid content-start gap-3 2xl:col-span-3">
            <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
              <div className="mb-3">
                <p className="text-sm font-semibold text-v6-ink">点をつける・引くこと</p>
                <p className="mt-1 text-xs text-v6-ink-faint">上から順にあてはめます。同じことが2回起きたら、2回ぶん動きます。</p>
              </div>
              {bundle.rules.length === 0 ? (
                <ListState kind="empty" title="スコアのルールがありません" description="公開するには、動かすルールを1件以上追加してください。" action={canEdit ? <Button onClick={addRule}>できごとを足す</Button> : undefined} />
              ) : (
                <div className="grid gap-2">
                  {bundle.rules.map((rule, index) => (
                    <div key={rule.id} className="grid min-h-10 grid-cols-12 items-center gap-3 rounded-control px-3 py-2" style={{ background: rule.enabled ? 'var(--color-surface-pearl)' : 'var(--color-canvas-sunken)', opacity: rule.enabled ? 1 : 0.72 }}>
                      <button type="button" disabled={!canEdit} className="col-span-6 flex min-w-0 items-center gap-3 text-left font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default" aria-label={`${rule.name}を編集`} onClick={() => setEditRuleIndex(index)}>
                        <span style={{ color: rule.value < 0 || rule.operation === 'set' ? 'var(--color-status-warn-deep)' : 'var(--color-accent-hover)' }}><RuleIcon eventType={rule.eventType} /></span>
                        <span className="truncate">{rule.name}</span>
                        {canEdit ? <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" /> : null}
                      </button>
                      <span className="col-span-2 text-right text-sm font-bold" style={{ color: rule.value < 0 || rule.operation === 'set' ? 'var(--color-status-warn-deep)' : 'var(--color-accent-hover)' }}>{rulePointLabel(rule)}</span>
                      <span className="col-span-3 text-xs text-ink-secondary">{ruleFrequencyLabel(rule)}</span>
                      {canEdit ? <button type="button" className="col-span-1 justify-self-end rounded-control p-2 text-status-danger hover:bg-status-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-danger" aria-label={`${rule.name}を削除`} onClick={() => removeRule(index)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}
                    </div>
                  ))}
                </div>
              )}
              {canEdit ? <Button className="mt-3" onClick={addRule}><Plus className="h-4 w-4" aria-hidden="true" />できごとを足す</Button> : null}
            </section>

            <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
              <p className="text-sm font-semibold text-v6-ink">帯の分けかた</p>
              <p className="mt-1 text-xs text-v6-ink-faint">この分けかたで、配信の相手を選べます。</p>
              <div className="mt-4 grid max-w-2xl grid-cols-3 gap-3">
                <Field label="高い（以上）" htmlFor="score-high"><TextInput id="score-high" type="number" value={bundle.bands.highMin} disabled={!canEdit} onChange={(event) => updateBands({ highMin: Number(event.target.value) })} /></Field>
                <Field label="ふつう（以上）" htmlFor="score-normal"><TextInput id="score-normal" type="number" value={bundle.bands.normalMin} disabled={!canEdit} onChange={(event) => updateBands({ normalMin: Number(event.target.value) })} /></Field>
                <Field label="点の上限" htmlFor="score-max"><TextInput id="score-max" type="number" value={bundle.bands.max} disabled={!canEdit} onChange={(event) => updateBands({ max: Number(event.target.value) })} /></Field>
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-3">
            <section className="rounded-v6-card border border-status-warn bg-status-warn-soft p-4 text-xs text-status-warn-deep">
              <p className="font-semibold">マイルとの違い</p>
              <div className="mt-3 grid gap-3">
                <div className="flex gap-2"><EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>お客様には見えません</strong><br />顧客カルテにも出しません</p></div>
                <div className="flex gap-2"><WalletCards className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>マイル残高は動きません</strong><br />点が下がっても、マイルは減りません</p></div>
                <div className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>過去の点数は書き換えません</strong><br />新しいできごとから新しいルールが動きます</p></div>
                <div className="flex gap-2"><MailX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>「メッセージを開いた」は使えません</strong><br />LINEは既読を返さないため、ルールにできません</p></div>
              </div>
            </section>

            <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
              <p className="text-sm font-semibold text-v6-ink">つながる先</p>
              <div className="mt-3 grid gap-2 text-xs">
                <Link href="/broadcasts/new" className="text-v6-accent hover:underline">一斉配信 <span className="text-v6-ink-faint">— 帯で相手を選ぶ</span></Link>
                <Link href="/scenarios" className="text-v6-accent hover:underline">シナリオ配信 <span className="text-v6-ink-faint">— 帯を条件にする</span></Link>
                <Link href="/automations" className="text-v6-accent hover:underline">オートメーション <span className="text-v6-ink-faint">— 点が下がったときに動かす</span></Link>
                <Link href="/analytics" className="text-v6-accent hover:underline">分析 <span className="text-v6-ink-faint">— 帯ごとの成果を見る</span></Link>
                <Link href="/mileage" className="text-v6-accent hover:underline">マイル <span className="text-v6-ink-faint">— お客様の残高を見る</span></Link>
              </div>
            </section>
          </aside>
        </div>

        {notice ? <p className="rounded-v6-control border border-v6-accent/25 bg-v6-accent-soft px-4 py-3 text-sm text-v6-accent-hover" role="status">{notice}</p> : null}
        {actionError ? <p className="rounded-v6-control border border-v6-danger/25 bg-v6-danger-bg px-4 py-3 text-sm text-v6-danger" role="alert">{actionError}</p> : null}

        <div className="sticky bottom-0 z-20 mt-auto grid min-h-16 grid-cols-4 items-center rounded-v6-card border border-hairline bg-canvas/95 px-4 py-3 shadow-v6-card backdrop-blur">
          <p className="text-xs text-v6-ink-faint">{versionLabel}。公開後に起きたことから新しい点数が付きます。</p>
          <div className="col-span-2 flex items-center justify-center gap-3">
          {configuration.currentPublishedVersionId ? <Button onClick={() => setConfirmAction({ kind: 'stop' })} disabled={!canEdit || busy}>公開中のルールを停止</Button> : null}
          <Button onClick={() => void saveDraft()} disabled={!canEdit || busy}>下書きに保存</Button>
          <Button variant="primary" onClick={() => void preparePublish()} disabled={!canEdit || busy || bundle.rules.every((rule) => !rule.enabled)}>スコアのルールを公開</Button>
          </div>
          <span aria-hidden="true" />
        </div>
      </> : null}

      <Dialog
        open={testOpen}
        title="1人でスコアのルールを試す"
        description="友だちの点数や履歴は変えません。"
        onCancel={() => !busy && setTestOpen(false)}
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setTestOpen(false)} disabled={busy}>閉じる</Button><Button variant="primary" onClick={() => void runTest()} disabled={busy}>この条件をテスト</Button></div>}
      >
        <div className="grid gap-3">
          <Field label="テスト前の点数" htmlFor="test-score"><TextInput id="test-score" type="number" value={testScore} onChange={(event) => setTestScore(event.target.value)} /></Field>
          <Field label="試す行動"><Select aria-label="テストする行動" value={testEvent} onChange={setTestEvent} options={[...EVENT_OPTIONS]} size="full" /></Field>
          {testResult ? (
            <div className="rounded-v6-control border border-v6-accent/25 bg-v6-accent-soft p-3 text-xs text-v6-ink-secondary" role="status">
              <p className="font-semibold text-v6-ink">{testResult.scoreBefore}点 → {testResult.scoreAfter}点</p>
              <p className="mt-1">合ったルール：{testResult.matched.length ? testResult.matched.map((item) => item.ruleName).join('、') : 'なし'}</p>
            </div>
          ) : null}
        </div>
      </Dialog>

      {bundle && editRuleIndex !== null && bundle.rules[editRuleIndex] ? (() => {
        const rule = bundle.rules[editRuleIndex]
        return (
          <Dialog
            open
            title="できごとの設定を直す"
            description="保存するまでは、友だちの点数や履歴は変わりません。"
            onCancel={() => setEditRuleIndex(null)}
            footer={<div className="flex justify-end"><Button variant="primary" onClick={() => setEditRuleIndex(null)}>設定を反映</Button></div>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="表示名" htmlFor="rule-name"><TextInput id="rule-name" value={rule.name} onChange={(event) => updateRule(editRuleIndex, { name: event.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="きっかけ"><Select aria-label={`${rule.name}のきっかけ`} value={eventValue(rule)} onChange={(value) => {
                const [eventType, source] = value.split('|')
                const name = EVENT_OPTIONS.find((option) => option.value === value)?.label ?? rule.name
                updateRule(editRuleIndex, { eventType, source: source || null, name })
              }} options={[...EVENT_OPTIONS]} size="full" /></Field></div>
              <Field label="点数の変え方"><Select aria-label={`${rule.name}の点数の変え方`} value={operationValue(rule)} onChange={(value) => updateRule(editRuleIndex, value === 'set-zero'
                ? { operation: 'set', value: 0 }
                : { operation: 'delta', value: value === 'subtract' ? -Math.max(1, Math.abs(rule.value)) : Math.max(1, Math.abs(rule.value)) })} options={[{ value: 'add', label: '増やす' }, { value: 'subtract', label: '減らす' }, { value: 'set-zero', label: '0にする' }]} size="full" /></Field>
              <Field label="点数" htmlFor="rule-score"><TextInput id="rule-score" type="number" min={rule.operation === 'set' ? 0 : 1} value={Math.abs(rule.value)} disabled={rule.operation === 'set'} onChange={(event) => {
                const amount = Math.abs(Number(event.target.value))
                updateRule(editRuleIndex, { value: operationValue(rule) === 'subtract' ? -amount : amount })
              }} /></Field>
              <Field label="回数"><Select aria-label={`${rule.name}の回数制限`} value={rule.frequency.kind} onChange={(value) => updateRule(editRuleIndex, { frequency: { kind: value as ActionScoreFrequencyKind, limit: 1 } })} options={FREQUENCY_OPTIONS} size="full" /></Field>
              <Field label="上限回数" htmlFor="rule-limit"><TextInput id="rule-limit" type="number" min={1} max={1000} value={rule.frequency.limit} disabled={!['per_day', 'per_subject', 'per_subject_per_day'].includes(rule.frequency.kind)} onChange={(event) => updateRule(editRuleIndex, { frequency: { ...rule.frequency, limit: Number(event.target.value) } })} /></Field>
              <Field label="開始日時" htmlFor="rule-start"><TextInput id="rule-start" type="datetime-local" value={localDateTime(rule.validFrom)} onChange={(event) => updateRule(editRuleIndex, { validFrom: utcDateTime(event.target.value) })} /></Field>
              <Field label="終了日時" htmlFor="rule-end"><TextInput id="rule-end" type="datetime-local" value={localDateTime(rule.validUntil)} onChange={(event) => updateRule(editRuleIndex, { validUntil: utcDateTime(event.target.value) })} /></Field>
              <div className="sm:col-span-2"><Toggle checked={rule.enabled} label="このできごとを動かす" onChange={(enabled) => updateRule(editRuleIndex, { enabled })} /></div>
            </div>
          </Dialog>
        )
      })() : null}

      <ConfirmDialog
        open={confirmAction?.kind === 'publish'}
        title="この版を公開しますか"
        description="公開後の行動から、新しいルールで点数が変わります。過去の履歴は書き換えません。公開した版自体も編集できません。"
        confirmLabel="この版を公開"
        busy={busy}
        error={actionError}
        onCancel={() => !busy && setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.kind === 'publish') void publish(confirmAction.draftVersionId)
        }}
      />
      <ConfirmDialog
        open={confirmAction?.kind === 'stop'}
        title="公開中のルールを停止しますか"
        description="これ以降の行動では点数を変えません。現在の点数と過去の履歴はそのまま残ります。"
        confirmLabel="公開中のルールを停止"
        destructive
        busy={busy}
        error={actionError}
        onCancel={() => !busy && setConfirmAction(null)}
        onConfirm={() => void stop()}
      />
    </main>
  )
}
