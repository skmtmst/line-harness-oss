'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, CalendarCheck, Clock3, ClipboardList, EyeOff, MailX, MessageCircle, MousePointerClick, Pencil, Plus, RefreshCw, ShoppingBag, UserPlus, WalletCards } from 'lucide-react'
import { EC_EVENT_LABELS, EC_EVENT_TYPES } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Field, TextInput } from '@/components/shared/form-controls'
import DateTimeField from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import { notifyToast } from '@/components/shared/toast'
import Toggle from '@/components/shared/toggle'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  type ActionScoreBandPreview,
  type ActionScoreBands,
  type ActionScoreFrequencyKind,
  type ActionScoreRule,
  type ActionScoreRuleBundle,
  type ActionScoreRuleConfiguration,
  type ActionScoreRuleTestResult,
} from '@/lib/api'
import { localDateTime, utcDateTime } from '@/lib/presentation'
import { validateRuleName, validateTestScore } from './score-rules-validation'

type ConfirmAction = { kind: 'publish'; draftVersionId: string } | { kind: 'stop' } | null

/*
 * N-239: ここに出せるきっかけは、実際にスコアへ届く出来事だけ。
 * `イベントの種類|発生元` の値は発火側（LINE webhook・予約・決済・EC連携・
 * 受信箱）と1つずつ対応させた。発生元が複数ある出来事（予約）や、スコアへ
 * 届かない出来事（タグ付与・ウェビナー視聴などマイル専用）は出さない。
 */
const EVENT_OPTIONS = [
  { value: 'message_received|line_webhook', label: 'メッセージに返信した' },
  { value: 'postback_received|line_webhook', label: 'リッチメニューなどのボタンを押した' },
  { value: 'friend_add|line_webhook', label: '友だちになった' },
  { value: 'friend_unfollow|line_webhook', label: 'ブロックした' },
  { value: 'link_clicked|tracked_link', label: '配信のURLを押した' },
  { value: 'form_submitted|form', label: '回答フォームに答えた' },
  { value: 'booking_created|', label: '予約した' },
  { value: 'purchase_completed|stripe', label: '購入した' },
  { value: 'cv_fire|stripe', label: '購入の成果が計測された' },
  { value: 'staff_assigned|inbox_assignment', label: '受信箱で担当者が付いた' },
  { value: 'manual_reply_sent|manual_reply', label: '担当者が個別に返信した' },
  { value: 'inactivity_30d|scheduler', label: '30日間反応がない' },
  // EC連携から届く出来事。発生元はすべてEC-CUBE本体（source: eccube）。
  ...EC_EVENT_TYPES.map((eventType) => ({
    value: `${eventType}|eccube`,
    label: `EC：${EC_EVENT_LABELS[eventType]}`,
  })),
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
  if (eventType === 'link_clicked' || eventType === 'postback_received') return <MousePointerClick className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'message_received' || eventType === 'manual_reply_sent' || eventType === 'staff_assigned') return <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'friend_add') return <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'form_submitted') return <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'booking_created') return <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (eventType === 'purchase_completed' || eventType === 'cv_fire' || eventType.startsWith('ec.')) return <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
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
    // R130: 422の本文はWorkerが付けた日本語の検証文だけ（`lib/api.ts`の
    // BODY_MESSAGE_STATUSESで監査済み）。400と同じくそのまま出す。
    // 落とすと入力ミスが「時間をおいてもう一度」に化けて直し方が分からない。
    if (error.status === 400 || error.status === 422) return error.message
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
  useEffect(() => {
    latestAccountRef.current = selectedAccountId
  }, [selectedAccountId])
  const [configuration, setConfiguration] = useState<ActionScoreRuleConfiguration | null>(null)
  const [bundle, setBundle] = useState<ActionScoreRuleBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [editRuleIndex, setEditRuleIndex] = useState<number | null>(null)
  // ほかの一覧と同じく、削除は「…」の中へ入れ、押した先で確認を出す。
  const [deleteRuleIndex, setDeleteRuleIndex] = useState<number | null>(null)
  /*
   * R129: 編集窓の入力は仮状態（`editDraft`）にだけ書き、「設定を反映」で
   * 親の一覧へ渡す。閉じる・Escapeは仮状態を捨てるだけ。入力のたび親を
   * 変えていたため、反映せず閉じたつもりの変更が残ってしまっていた。
   */
  const [editDraft, setEditDraft] = useState<ActionScoreRule | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testScore, setTestScore] = useState('30')
  const [testEvent, setTestEvent] = useState<string>(EVENT_OPTIONS[0].value)
  const [testResult, setTestResult] = useState<ActionScoreRuleTestResult | null>(null)
  /*
   * R301: 試算後に点数・行動を変えたら古い成功結果を残さない。入力のたび
   * 結果を消し、要求ごとの番号で遅れて届いた古い応答も新しい入力へ
   * 表示しない（入力を変えると番号が進み、古い応答は捨てられる）。
   */
  const testRunRef = useRef(0)
  // R303: 空の表示名で「設定を反映」したときの理由。欄の下で見せる。
  const [editError, setEditError] = useState('')
  // R130: 試算の入力ミスは窓の外ではなく窓の中・欄の下で見せる。
  const [testError, setTestError] = useState('')
  const [testScoreError, setTestScoreError] = useState('')
  /*
   * N-235: 帯の分けかたを変えたとき「何人がどの帯へ入るか」を先に数える
   * 読み取り専用の試算。公開版も友だちの点数も動かさない。
   * 分けかたを編集したら古い結果は捨てる（`updateBands` で null）。
   */
  const [bandPreview, setBandPreview] = useState<ActionScoreBandPreview | null>(null)
  const [bandPreviewBusy, setBandPreviewBusy] = useState(false)

  useEffect(() => {
    let current = true
    void api.staff.me().then((response) => {
      if (!current || !response.success) return
      setCanEdit(response.data.role === 'owner' || response.data.role === 'admin')
    }).catch(() => {
      if (current) setCanEdit(false)
    })
    return () => { current = false }
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
    setTestResult(null)
    setBundle((current) => current ? {
      ...current,
      rules: current.rules.map((rule, position) => position === index
        ? { ...rule, ...updates, frequency: updates.frequency ? { ...updates.frequency } : rule.frequency }
        : rule),
    } : current)
  }

  const updateBands = (updates: Partial<ActionScoreBands>) => {
    setTestResult(null)
    setBandPreview(null)
    setBundle((current) => current ? { ...current, bands: { ...current.bands, ...updates } } : current)
  }

  const updateEditDraft = (updates: Partial<ActionScoreRule>) => {
    setEditDraft((current) => current ? {
      ...current,
      ...updates,
      frequency: updates.frequency ? { ...updates.frequency } : current.frequency,
    } : current)
  }

  const closeEditor = () => {
    setEditRuleIndex(null)
    setEditDraft(null)
    setEditError('')
  }

  /*
   * R303: 空・空白の表示名では一覧へ追加せず、編集窓を維持して欄の下に
   * 理由を出す。新規追加も既存の編集も同じ条件で検証し、直してから反映する。
   */
  const applyEditor = () => {
    if (editRuleIndex === null || !editDraft) {
      closeEditor()
      return
    }
    const checked = validateRuleName(editDraft.name)
    if (!checked.ok) {
      setEditError(checked.error)
      return
    }
    updateRule(editRuleIndex, { ...editDraft, name: checked.value })
    closeEditor()
  }

  /*
   * 編集中の分けかたで、いまの友だちの点数がどの帯へ分かれるかだけ数える。
   * 書き込みは一切しない（`POST /api/action-scores/bands/preview` は読み取り専用）。
   */
  const previewBands = async () => {
    if (!selectedAccountId || !bundle || bandPreviewBusy) return
    setBandPreviewBusy(true)
    setActionError('')
    try {
      const response = await api.actionScores.previewBands({
        accountId: selectedAccountId,
        bands: bundle.bands,
      })
      if (!response.success) throw new Error(response.error)
      setBandPreview(response.data)
    } catch (error) {
      setBandPreview(null)
      setActionError(fieldError(error))
    } finally {
      setBandPreviewBusy(false)
    }
  }

  const addRule = () => {
    if (!bundle) return
    const id = `rule-${crypto.randomUUID()}`
    const nextIndex = bundle.rules.length
    const created: ActionScoreRule = {
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
    }
    setBundle({
      ...bundle,
      rules: [...bundle.rules, created],
    })
    setEditDraft({ ...created, frequency: { ...created.frequency } })
    setEditRuleIndex(nextIndex)
  }

  const removeRule = (index: number) => {
    setBundle((current) => current ? {
      ...current,
      rules: current.rules.filter((_, position) => position !== index),
    } : current)
  }

  const saveDraft = async () => {
    if (!selectedAccountId || !bundle) return null
    const accountAtRequest = selectedAccountId
    setBusy(true)
    setActionError('')
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
      notifyToast(`下書き（第${response.data.editableVersion.versionNumber}版）を保存しました。`)
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
      notifyToast(`第${response.data.publishedVersion?.versionNumber ?? '—'}版を公開しました。利用先は公開した版に固定されます。`)
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
      notifyToast('公開中のルールを止めました。過去の点数と履歴は残ります。')
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
    // R302: 空欄・空白だけは必須エラーにし、0として送らない。
    const checked = validateTestScore(testScore, bundle.bands)
    if (!checked.ok) {
      setTestScoreError(checked.error)
      return
    }
    const runId = ++testRunRef.current
    setBusy(true)
    setTestError('')
    setTestScoreError('')
    setTestResult(null)
    try {
      const response = await api.actionScores.testRules({
        accountId: accountAtRequest,
        configuration: bundle,
        currentScore: checked.value,
        eventType,
        source: source || null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      // R301: 待っている間に点数・行動が変わったら、この応答は古いので捨てる。
      if (testRunRef.current !== runId) return
      if (!response.success) throw new Error(response.error)
      setTestResult(response.data)
    } catch (error) {
      // R130: 点数の範囲ミスは欄の下で上限とともに説明し、窓の中に留める。
      // 窓の外の帯へ出すと通信障害に見えて直し方が分からない。
      if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
        setTestScoreError(`テストする点数は${bundle.bands.min}〜${bundle.bands.max}の整数で入力してください`)
      } else {
        setTestError(fieldError(error))
      }
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
    <div data-design-node="s6MBc" className="flex flex-col gap-3.5" style={{ minHeight: 'calc(100vh - 98px)' }}>
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
            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <div className="mb-3">
                <p className="text-sm font-semibold text-ink">点をつける・引くこと</p>
                <p className="mt-1 text-xs text-ink-faint">上から順にあてはめます。同じことが2回起きたら、2回ぶん動きます。</p>
              </div>
              {bundle.rules.length === 0 ? (
                <ListState kind="empty" title="スコアのルールがありません" description="公開するには、動かすルールを1件以上追加してください。" action={canEdit ? <Button onClick={addRule}>できごとを足す</Button> : undefined} />
              ) : (
                <div className="grid gap-2">
                  {bundle.rules.map((rule, index) => (
                    /*
                     * #975 U047: 390pxでは名前が4文字程度で省略され、頻度の
                     * 折れと編集・削除が密集していた。狭い幅では名前を1段目の
                     * 全幅に、点数・頻度・削除を2段目へ下げる。640px以上は
                     * 従来の1行のまま。点数の向き（増やす・減らす・0にする）は
                     * 色ではなく「＋」「−」「0にする」の文字で持つ。
                     *
                     * 無効の行は地の色だけ変える。行全体を 72% に薄めると
                     * 文字が #7d8590（3.54:1）まで落ちて読めない。
                     */
                    <div key={rule.id} className="grid min-h-10 grid-cols-12 items-center gap-x-3 gap-y-1 rounded-control px-3 py-2" style={{ background: rule.enabled ? 'var(--color-surface-pearl)' : 'var(--color-canvas-sunken)' }}>
                      <button type="button" disabled={!canEdit} className="col-span-12 flex min-w-0 items-center gap-3 text-left font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default sm:col-span-6" aria-label={`${rule.name}を編集`} onClick={() => { setEditDraft({ ...rule, frequency: { ...rule.frequency } }); setEditRuleIndex(index) }}>
                        <span style={{ color: rule.value < 0 || rule.operation === 'set' ? 'var(--color-status-warn-deep)' : 'var(--color-ink-secondary)' }}><RuleIcon eventType={rule.eventType} /></span>
                        <span className="truncate" title={rule.name}>{rule.name}</span>
                        {canEdit ? <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" /> : null}
                      </button>
                      <span className="col-span-2 text-left text-sm font-bold text-ink sm:text-right">{rulePointLabel(rule)}</span>
                      <span className="col-span-9 text-xs text-ink-secondary sm:col-span-3">{ruleFrequencyLabel(rule)}</span>
                      {/*
                        * ほかの一覧と同じく、削除は行の赤いゴミ箱ではなく
                        * 「…」の中の「削除する」へ入れる。押した先で確認を
                        * 出し、間違って消さない（LAY-18）。
                        */}
                      {canEdit ? (
                        <span className="col-span-1 justify-self-end">
                          <RowActions
                            subjectName={rule.name}
                            destructiveItem={{
                              id: 'delete',
                              label: '削除する',
                              onSelect: () => setDeleteRuleIndex(index),
                            }}
                          />
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {canEdit ? <Button className="mt-3" onClick={addRule}><Plus className="h-4 w-4" aria-hidden="true" />できごとを足す</Button> : null}
            </section>

            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <p className="text-sm font-semibold text-ink">帯の分けかた</p>
              <p className="mt-1 text-xs text-ink-faint">この分けかたで、配信の相手を選べます。</p>
              <div className="mt-4 grid max-w-2xl grid-cols-3 gap-3">
                <Field label="高い（以上）" htmlFor="score-high"><TextInput id="score-high" type="number" value={bundle.bands.highMin} disabled={!canEdit} onChange={(event) => updateBands({ highMin: Number(event.target.value) })} /></Field>
                <Field label="ふつう（以上）" htmlFor="score-normal"><TextInput id="score-normal" type="number" value={bundle.bands.normalMin} disabled={!canEdit} onChange={(event) => updateBands({ normalMin: Number(event.target.value) })} /></Field>
                <Field label="点の上限" htmlFor="score-max"><TextInput id="score-max" type="number" value={bundle.bands.max} disabled={!canEdit} onChange={(event) => updateBands({ max: Number(event.target.value) })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button onClick={() => void previewBands()} disabled={!canEdit || bandPreviewBusy}>
                  {bandPreviewBusy ? '数えています' : 'この分けかただと何人入るか見る'}
                </Button>
                {bandPreview ? (
                  <p className="text-xs text-ink-secondary" role="status">
                    高い {bandPreview.counts.high.toLocaleString('ja-JP')}人・ふつう {bandPreview.counts.normal.toLocaleString('ja-JP')}人・低い {bandPreview.counts.low.toLocaleString('ja-JP')}人
                    <span className="text-ink-faint">（全{bandPreview.totalFriends.toLocaleString('ja-JP')}人・{bandPreview.measuredAt.slice(0, 10)}時点・点数は変わりません）</span>
                  </p>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-3">
            <Notice tone="warn">
              <p className="text-xs font-semibold">マイルとの違い</p>
              <div className="mt-3 grid gap-3">
                <div className="flex gap-2"><EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>お客様には見えません</strong><br />顧客カルテにも出しません</p></div>
                <div className="flex gap-2"><WalletCards className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>マイル残高は動きません</strong><br />点が下がっても、マイルは減りません</p></div>
                <div className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>過去の点数は書き換えません</strong><br />新しいできごとから新しいルールが動きます</p></div>
                <div className="flex gap-2"><MailX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>「メッセージを開いた」は使えません</strong><br />LINEは既読を返さないため、ルールにできません</p></div>
                <div className="flex gap-2"><Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p><strong>マイル専用のきっかけは出しません</strong><br />タグ付与・ウェビナー視聴・継続フォロー日数・紹介成果などは、マイルの決めごとから選べます</p></div>
              </div>
            </Notice>

            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <p className="text-sm font-semibold text-ink">つながる先</p>
              <div className="mt-3 grid gap-2 text-xs">
                <Link href="/broadcasts/new" className="text-action hover:underline">一斉配信 <span className="text-ink-faint">— 帯で相手を選ぶ</span></Link>
                <Link href="/scenarios" className="text-action hover:underline">シナリオ配信 <span className="text-ink-faint">— 帯を条件にする</span></Link>
                <Link href="/automations" className="text-action hover:underline">オートメーション <span className="text-ink-faint">— 点が下がったときに動かす</span></Link>
                <Link href="/analytics" className="text-action hover:underline">分析 <span className="text-ink-faint">— 帯ごとの成果を見る</span></Link>
                <Link href="/mileage" className="text-action hover:underline">マイル <span className="text-ink-faint">— お客様の残高を見る</span></Link>
              </div>
            </section>
          </aside>
        </div>

        {actionError ? <Notice tone="danger" message={actionError} /> : null}

        {/*
          #973 U046: 4列固定はやめ、上に状態文を全幅、下に押し口を折り返しで
          並べる。狭い幅でも押し口が文を潰さない。
        */}
        <div className="sticky bottom-0 z-20 mt-auto rounded-card border border-hairline bg-canvas/95 px-4 py-3 shadow-card backdrop-blur">
          <p className="text-xs text-ink-faint">{versionLabel}。公開後に起きたことから新しい点数が付きます。</p>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
          {configuration.currentPublishedVersionId ? <Button onClick={() => setConfirmAction({ kind: 'stop' })} disabled={!canEdit || busy}>公開中のルールを停止</Button> : null}
          <Button onClick={() => void saveDraft()} disabled={!canEdit || busy}>下書きに保存</Button>
          <Button variant="primary" onClick={() => void preparePublish()} disabled={!canEdit || busy || bundle.rules.every((rule) => !rule.enabled)}>スコアのルールを公開</Button>
          </div>
        </div>
      </> : null}

      <Dialog
        open={testOpen}
        title="1人でスコアのルールを試す"
        description="友だちの点数や履歴は変えません。"
        error={testError || undefined}
        onCancel={() => { if (!busy) { setTestOpen(false); setTestError(''); setTestScoreError('') } }}
        footer={<div className="flex justify-end gap-2"><Button variant="primary" onClick={() => void runTest()} disabled={busy}>この条件をテスト</Button></div>}
      >
        <div className="grid gap-3">
          <Field label="テスト前の点数" htmlFor="test-score" note={`${bundle?.bands.min ?? 0}〜${bundle?.bands.max ?? 100}の整数で入力`} error={testScoreError || undefined}><TextInput id="test-score" type="number" value={testScore} invalid={Boolean(testScoreError)} onChange={(event) => { setTestScore(event.target.value); setTestScoreError(''); setTestResult(null); testRunRef.current += 1 }} /></Field>
          <Field label="試す行動"><Select aria-label="テストする行動" value={testEvent} onChange={(value) => { setTestEvent(value); setTestError(''); setTestResult(null); testRunRef.current += 1 }} options={[...EVENT_OPTIONS]} size="full" /></Field>
          {testResult ? (
            <Notice tone="success">
              <p className="text-xs font-semibold">{testResult.scoreBefore}点 → {testResult.scoreAfter}点</p>
              <p className="mt-1 text-xs">合ったルール：{testResult.matched.length ? testResult.matched.map((item) => item.ruleName).join('、') : 'なし'}</p>
            </Notice>
          ) : null}
        </div>
      </Dialog>

      {bundle && editRuleIndex !== null && editDraft ? (() => {
        const rule = editDraft
        return (
          <Dialog
            open
            title="できごとの設定を直す"
            description="「設定を反映」を押すまで、一覧の内容は変わりません。閉じただけでは入力は残りません。"
            onCancel={() => closeEditor()}
            footer={<div className="flex justify-end"><Button variant="primary" onClick={() => applyEditor()}>設定を反映</Button></div>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="表示名" htmlFor="rule-name" error={editError || undefined}><TextInput id="rule-name" value={rule.name} invalid={Boolean(editError)} onChange={(event) => { updateEditDraft({ name: event.target.value }); setEditError('') }} /></Field></div>
              <div className="sm:col-span-2"><Field label="きっかけ"><Select aria-label={`${rule.name}のきっかけ`} value={eventValue(rule)} onChange={(value) => {
                const [eventType, source] = value.split('|')
                const name = EVENT_OPTIONS.find((option) => option.value === value)?.label ?? rule.name
                updateEditDraft({ eventType, source: source || null, name })
              }} options={[...EVENT_OPTIONS]} size="full" /></Field></div>
              <Field label="点数の変え方"><Select aria-label={`${rule.name}の点数の変え方`} value={operationValue(rule)} onChange={(value) => updateEditDraft(value === 'set-zero'
                ? { operation: 'set', value: 0 }
                : { operation: 'delta', value: value === 'subtract' ? -Math.max(1, Math.abs(rule.value)) : Math.max(1, Math.abs(rule.value)) })} options={[{ value: 'add', label: '増やす' }, { value: 'subtract', label: '減らす' }, { value: 'set-zero', label: '0にする' }]} size="full" /></Field>
              <Field label="点数" htmlFor="rule-score"><TextInput id="rule-score" type="number" min={rule.operation === 'set' ? 0 : 1} value={Math.abs(rule.value)} disabled={rule.operation === 'set'} onChange={(event) => {
                const amount = Math.abs(Number(event.target.value))
                updateEditDraft({ value: operationValue(rule) === 'subtract' ? -amount : amount })
              }} /></Field>
              <Field label="回数"><Select aria-label={`${rule.name}の回数制限`} value={rule.frequency.kind} onChange={(value) => updateEditDraft({ frequency: { kind: value as ActionScoreFrequencyKind, limit: 1 } })} options={FREQUENCY_OPTIONS} size="full" /></Field>
              <Field label="上限回数" htmlFor="rule-limit"><TextInput id="rule-limit" type="number" min={1} max={1000} value={rule.frequency.limit} disabled={!['per_day', 'per_subject', 'per_subject_per_day'].includes(rule.frequency.kind)} onChange={(event) => updateEditDraft({ frequency: { ...rule.frequency, limit: Number(event.target.value) } })} /></Field>
              <Field label="開始日時" htmlFor="rule-start"><DateTimeField id="rule-start" value={localDateTime(rule.validFrom)} onChange={(v) => updateEditDraft({ validFrom: utcDateTime(v) })} /></Field>
              <Field label="終了日時" htmlFor="rule-end"><DateTimeField id="rule-end" value={localDateTime(rule.validUntil)} onChange={(v) => updateEditDraft({ validUntil: utcDateTime(v) })} /></Field>
              <div className="sm:col-span-2"><Toggle checked={rule.enabled} label="このできごとを動かす" onChange={(enabled) => updateEditDraft({ enabled })} /></div>
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
      <ConfirmDialog
        open={deleteRuleIndex !== null}
        title={`「${deleteRuleIndex !== null ? bundle?.rules[deleteRuleIndex]?.name ?? '' : ''}」を削除しますか？`}
        description="下書きから消えます。公開中の版と友だちの点数は変わりません。「下書きに保存」を押すまで確定しません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setDeleteRuleIndex(null)}
        onConfirm={() => {
          if (deleteRuleIndex !== null) removeRule(deleteRuleIndex)
          setDeleteRuleIndex(null)
        }}
      />
    </div>
  )
}
