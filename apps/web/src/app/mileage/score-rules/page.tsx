'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp, FlaskConical, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Field, TextInput } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
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

function localDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function utcDateTime(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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
    const id = `rule-${crypto.randomUUID()}`
    setBundle((current) => current ? {
      ...current,
      rules: [...current.rules, {
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
    } : current)
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
    <main data-design-node="s6MBc" className="space-y-3.5 pb-24">
      {!selectedAccountId && !accountLoading ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="スコアのルールは、共通トップバーで選んだLINEアカウントごとに保存します。" />
      ) : loading || accountLoading ? (
        <ListState kind="loading" title="スコアのルールを読み込んでいます" description="下書きと公開中の版を確認しています。" />
      ) : forbidden ? (
        <ListState kind="forbidden" />
      ) : loadError ? (
        <ListState kind="error" title="スコアのルールを表示できませんでした" description="再読み込みしても直らない場合はエラー報告へ。" action={<Button onClick={() => void load()}>スコアのルールを再読み込み</Button>} />
      ) : bundle && configuration ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-v6-card border border-hairline bg-canvas px-4 py-3 shadow-v6-card">
          <div>
            <p className="text-sm font-semibold text-v6-ink">{versionLabel}</p>
            <p className="mt-1 text-xs text-v6-ink-faint">公開した版は書き換えません。変更は新版として作り、公開先を切り替えます。</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${configuration.status === 'published' ? 'bg-v6-accent-soft text-v6-accent-hover' : configuration.status === 'stopped' ? 'bg-v6-danger-bg text-v6-danger' : 'bg-v6-warning-bg text-v6-warning'}`}>
            {configuration.status === 'published' ? '動いています' : configuration.status === 'stopped' ? '止めています' : '下書き'}
          </span>
        </div>

        {/*
          **1440px では表を目いっぱい使う。** 4分割のままだと表に 820px しか
          回らず、`table-layout: fixed` の6列が等分されて
          「こちらに返信し**た**」「メッセ…」が切れる。
          右の柱は 1536px（`2xl`）から戻す。それより狭いときは下に3枚並べる。
        */}
        <div className="grid gap-3 2xl:grid-cols-4">
          <section className="rounded-v6-card border border-hairline bg-canvas shadow-v6-card 2xl:col-span-3">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-v6-ink">点数が変わる決めごと</p>
                <p className="mt-1 text-xs text-v6-ink-faint">同じ元の記録は必ず1回だけ数えます。この安全設定は外せません。</p>
              </div>
              {canEdit ? <Button onClick={addRule}><Plus className="h-4 w-4" aria-hidden="true" />ルールを追加</Button> : null}
            </div>

            {bundle.rules.length === 0 ? (
              <ListState kind="empty" title="スコアのルールがありません" description="公開するには、動かすルールを1件以上追加してください。" action={canEdit ? <Button onClick={addRule}>ルールを追加</Button> : undefined} />
            ) : (
              <DataTable>
                {/*
                  **幅を決める。** `DataTable` は `table-layout: fixed` なので、
                  決めないと6列が等分される。名前ときっかけがいちばん長いので、
                  ほかを詰めて残りを回す。
                */}
                <thead><TableHeadRow>
                  <Th className="w-24">動作</Th>
                  <Th>名前・きっかけ</Th>
                  <Th className="w-44">点数</Th>
                  <Th className="w-52">回数</Th>
                  <Th className="w-56">有効期間</Th>
                  <Th align="right" className="w-20">操作</Th>
                </TableHeadRow></thead>
                <tbody>{bundle.rules.map((rule, index) => (
                  <Tr key={rule.id}>
                    <Td>
                      {/*
                        **見るだけの人にはスイッチを出さない。**
                        共通の `Toggle` に「押せないが状態は見せる」入口は無く、
                        `locked` は**オンに固定して描く**印なので、止めている
                        ルールが「動いている」に見えてしまう。
                        動かせない相手には、下の文字だけで状態を伝える。
                      */}
                      {canEdit ? (
                        <Toggle checked={rule.enabled} label={`${rule.name}を動かす`} onChange={(enabled) => updateRule(index, { enabled })} />
                      ) : null}
                      <p className={`${canEdit ? 'mt-1 ' : ''}whitespace-nowrap text-xs text-v6-ink-faint`}>{rule.enabled ? '動かす' : '止める'}</p>
                    </Td>
                    <Td>
                      <TextInput aria-label={`${index + 1}件目のルール名`} value={rule.name} disabled={!canEdit} onChange={(event) => updateRule(index, { name: event.target.value })} />
                      <Select
                        aria-label={`${rule.name}のきっかけ`}
                        value={eventValue(rule)}
                        disabled={!canEdit}
                        onChange={(value) => {
                          const [eventType, source] = value.split('|')
                          updateRule(index, { eventType, source: source || null })
                        }}
                        options={[...EVENT_OPTIONS]}
                        size="full"
                        className="mt-2"
                      />
                    </Td>
                    <Td>
                      <Select
                        aria-label={`${rule.name}の点数の変え方`}
                        value={operationValue(rule)}
                        disabled={!canEdit}
                        onChange={(value) => updateRule(index, value === 'set-zero'
                          ? { operation: 'set', value: 0 }
                          : { operation: 'delta', value: value === 'subtract' ? -Math.max(1, Math.abs(rule.value)) : Math.max(1, Math.abs(rule.value)) })}
                        options={[
                          { value: 'add', label: '増やす' },
                          { value: 'subtract', label: '減らす' },
                          { value: 'set-zero', label: '0にする' },
                        ]}
                        size="full"
                      />
                      <TextInput
                        className="mt-2 w-full"
                        aria-label={`${rule.name}の点数`}
                        type="number"
                        min={rule.operation === 'set' ? 0 : 1}
                        value={Math.abs(rule.value)}
                        disabled={!canEdit || rule.operation === 'set'}
                        onChange={(event) => {
                          const amount = Math.abs(Number(event.target.value))
                          updateRule(index, { value: operationValue(rule) === 'subtract' ? -amount : amount })
                        }}
                      />
                    </Td>
                    <Td>
                      <Select
                        aria-label={`${rule.name}の回数制限`}
                        value={rule.frequency.kind}
                        disabled={!canEdit}
                        onChange={(value) => updateRule(index, { frequency: { kind: value as ActionScoreFrequencyKind, limit: 1 } })}
                        options={FREQUENCY_OPTIONS}
                        size="full"
                      />
                      {['per_day', 'per_subject', 'per_subject_per_day'].includes(rule.frequency.kind) ? (
                        <TextInput
                          className="mt-2 w-full"
                          aria-label={`${rule.name}の上限回数`}
                          type="number"
                          min={1}
                          max={1000}
                          value={rule.frequency.limit}
                          disabled={!canEdit}
                          onChange={(event) => updateRule(index, { frequency: { ...rule.frequency, limit: Number(event.target.value) } })}
                        />
                      ) : null}
                      <p className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs text-v6-accent-hover"><ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />同じ記録は1回だけ</p>
                    </Td>
                    <Td>
                      <TextInput aria-label={`${rule.name}の開始日時`} type="datetime-local" value={localDateTime(rule.validFrom)} disabled={!canEdit} onChange={(event) => updateRule(index, { validFrom: utcDateTime(event.target.value) })} />
                      <TextInput className="mt-2" aria-label={`${rule.name}の終了日時`} type="datetime-local" value={localDateTime(rule.validUntil)} disabled={!canEdit} onChange={(event) => updateRule(index, { validUntil: utcDateTime(event.target.value) })} />
                    </Td>
                    <ActionCell>
                      {canEdit ? <button type="button" className="rounded-v6-control p-2 text-v6-danger hover:bg-v6-danger-bg" aria-label={`${rule.name}を削除`} onClick={() => removeRule(index)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : '見るだけ'}
                    </ActionCell>
                  </Tr>
                ))}</tbody>
              </DataTable>
            )}
          </section>

          <aside className="grid gap-3 md:grid-cols-3 2xl:grid-cols-1">
            <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
              {/*
                **呼び方は「帯」。** 行動スコアのタブ側は統一済みで、
                この面だけ「層」に戻すと同じ機能の中で名前が2つになる。
                「層」は人を分ける言い方にも聞こえる（§7 #48）。
              */}
              <p className="text-sm font-semibold text-v6-ink">スコアの帯</p>
              <p className="mt-1 text-xs text-v6-ink-faint">一覧と配信の「低い・ふつう・高い」に使います。</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label="下限" htmlFor="score-min"><TextInput id="score-min" type="number" value={bundle.bands.min} disabled={!canEdit} onChange={(event) => updateBands({ min: Number(event.target.value) })} /></Field>
                <Field label="上限" htmlFor="score-max"><TextInput id="score-max" type="number" value={bundle.bands.max} disabled={!canEdit} onChange={(event) => updateBands({ max: Number(event.target.value) })} /></Field>
                <Field label="ふつうの開始" htmlFor="score-normal"><TextInput id="score-normal" type="number" value={bundle.bands.normalMin} disabled={!canEdit} onChange={(event) => updateBands({ normalMin: Number(event.target.value) })} /></Field>
                <Field label="高いの開始" htmlFor="score-high"><TextInput id="score-high" type="number" value={bundle.bands.highMin} disabled={!canEdit} onChange={(event) => updateBands({ highMin: Number(event.target.value) })} /></Field>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1 text-center text-xs">
                <span className="rounded-full bg-v6-surface-strong px-2 py-1 text-v6-ink-secondary">低い</span>
                <span className="rounded-full bg-v6-warning-bg px-2 py-1 text-v6-warning">ふつう</span>
                <span className="rounded-full bg-v6-accent-soft px-2 py-1 text-v6-accent-hover">高い</span>
              </div>
            </section>

            <section className="rounded-v6-card border border-v6-warning/30 bg-v6-warning-bg p-4 text-xs text-v6-ink-secondary">
              <p className="flex items-center gap-2 font-semibold text-v6-ink"><CircleHelp className="h-4 w-4" aria-hidden="true" />マイルとは別です</p>
              {/*
                **「マイルが減るのでは」に先に答える。** 交換できないこと、
                残高が動かないことを言う。タブ側（`action-score-tab.tsx`）と
                同じ文にそろえてある。
              */}
              <p className="mt-2"><strong className="text-v6-ink">スコアはマイルではありません。</strong>お客様には見せず、交換もできません。マイル残高はスコアで増えも減りもしません。対応や配信の順番を決める目安です。</p>
              <p className="mt-2">LINEの既読は取得できないため、「メッセージを開いた」はルールにできません。</p>
            </section>

            <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
              <p className="flex items-center gap-2 text-sm font-semibold text-v6-ink"><FlaskConical className="h-4 w-4" aria-hidden="true" />ルールをテスト</p>
              <p className="mt-1 text-xs text-v6-ink-faint">友だちの点数や履歴は変えません。</p>
              <div className="mt-3 space-y-3">
                <Field label="テスト前の点数" htmlFor="test-score"><TextInput id="test-score" type="number" value={testScore} onChange={(event) => setTestScore(event.target.value)} /></Field>
                <Field label="試す行動"><Select aria-label="テストする行動" value={testEvent} onChange={setTestEvent} options={[...EVENT_OPTIONS]} size="full" /></Field>
                <Button onClick={() => void runTest()} disabled={busy}>この条件をテスト</Button>
              </div>
              {testResult ? (
                <div className="mt-3 rounded-v6-control border border-v6-accent/25 bg-v6-accent-soft p-3 text-xs text-v6-ink-secondary" role="status">
                  <p className="font-semibold text-v6-ink">{testResult.scoreBefore}点 → {testResult.scoreAfter}点</p>
                  <p className="mt-1">合ったルール：{testResult.matched.length ? testResult.matched.map((item) => item.ruleName).join('、') : 'なし'}</p>
                </div>
              ) : null}
            </section>
          </aside>
        </div>

        {notice ? <p className="rounded-v6-control border border-v6-accent/25 bg-v6-accent-soft px-4 py-3 text-sm text-v6-accent-hover" role="status">{notice}</p> : null}
        {actionError ? <p className="rounded-v6-control border border-v6-danger/25 bg-v6-danger-bg px-4 py-3 text-sm text-v6-danger" role="alert">{actionError}</p> : null}

        <div className="sticky bottom-0 z-20 flex items-center justify-center gap-3 border-t border-hairline bg-canvas/95 px-4 py-3 shadow-v6-card backdrop-blur">
          {configuration.currentPublishedVersionId ? <Button onClick={() => setConfirmAction({ kind: 'stop' })} disabled={!canEdit || busy}>公開中のルールを停止</Button> : null}
          <Button onClick={() => void saveDraft()} disabled={!canEdit || busy}>下書きを保存</Button>
          <Button variant="primary" onClick={() => void preparePublish()} disabled={!canEdit || busy || bundle.rules.every((rule) => !rule.enabled)}>スコアのルールを公開</Button>
        </div>
      </> : null}

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
