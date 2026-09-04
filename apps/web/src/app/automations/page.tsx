'use client'

import SelectField from '@/components/shared/select-field'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'

type LoadStatus = 'loading' | 'ready' | 'error'

type AutomationEventType = "friend_add" | "tag_change" | "score_threshold" | "cv_fire" | "message_received" | "postback_received" | "calendar_booked" | "ec.order.confirmed" | "ec.order.shipped" | "ec.subscription.upcoming" | "ec.subscription.payment_failed" | "ec.subscription.cancelled"

interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu"
  params: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string | null
  eventType: AutomationEventType
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  isActive: boolean
  priority: number
  // null = global automation (fires for every account); UUID = bound to that
  // account. Surfaced so the badge + toggle/delete guards can distinguish.
  lineAccountId: string | null
  createdAt: string
  updatedAt: string
}

const eventTypeOptions: { value: AutomationEventType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加' },
  { value: 'tag_change', label: 'タグ変更' },
  { value: 'score_threshold', label: 'スコア閾値' },
  { value: 'cv_fire', label: 'CV発火' },
  { value: 'message_received', label: 'メッセージ受信' },
  { value: 'postback_received', label: 'ポストバック受信（リッチメニュー等）' },
  { value: 'calendar_booked', label: 'カレンダー予約' },
  { value: 'ec.order.confirmed', label: 'EC：注文確定' },
  { value: 'ec.order.shipped', label: 'EC：発送完了' },
  { value: 'ec.subscription.upcoming', label: 'EC：定期便の次回予定' },
  { value: 'ec.subscription.payment_failed', label: 'EC：定期便の決済失敗' },
  { value: 'ec.subscription.cancelled', label: 'EC：定期便の解約' },
]

const eventTypeLabelMap: Record<AutomationEventType, string> = {
  friend_add: '友だち追加',
  tag_change: 'タグ変更',
  score_threshold: 'スコア閾値',
  cv_fire: 'CV発火',
  message_received: 'メッセージ受信',
  postback_received: 'ポストバック受信',
  calendar_booked: 'カレンダー予約',
  'ec.order.confirmed': 'EC注文確定',
  'ec.order.shipped': 'EC発送完了',
  'ec.subscription.upcoming': '定期便予定',
  'ec.subscription.payment_failed': '定期便決済失敗',
  'ec.subscription.cancelled': '定期便解約',
}

const eventTypeBadgeColor: Record<AutomationEventType, string> = {
  friend_add: 'bg-success-bg text-green-700',
  tag_change: 'bg-blue-100 text-blue-700',
  score_threshold: 'bg-warning-bg text-yellow-700',
  cv_fire: 'bg-red-100 text-danger',
  message_received: 'bg-purple-100 text-purple-700',
  postback_received: 'bg-pink-100 text-pink-700',
  calendar_booked: 'bg-indigo-100 text-indigo-700',
  'ec.order.confirmed': 'bg-emerald-100 text-emerald-700',
  'ec.order.shipped': 'bg-cyan-100 text-cyan-700',
  'ec.subscription.upcoming': 'bg-teal-100 text-teal-700',
  'ec.subscription.payment_failed': 'bg-orange-100 text-orange-700',
  'ec.subscription.cancelled': 'bg-slate-100 text-slate-700',
}

/**
 * 確認窓が預かっている操作。
 *
 * `accountId` は**押した時点で選んでいたLINEアカウント**。窓を開けたまま
 * ヘッダーでアカウントを切り替えられるので、切り替わったことを窓の中で
 * 知らせて選び直させる。黙って閉じると「押したのに何も起きない」になる。
 */
type PendingAction = {
  kind: 'toggle' | 'delete'
  automation: Automation
  accountId: string | null
}

interface CreateFormState {
  name: string
  description: string
  eventType: AutomationEventType
  actionsJson: string
  conditionsJson: string
  priority: number
}

const initialForm: CreateFormState = {
  name: '',
  description: '',
  eventType: 'friend_add',
  actionsJson: '[\n  {\n    "type": "add_tag",\n    "params": {}\n  }\n]',
  conditionsJson: '{}',
  priority: 0,
}

export default function AutomationsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ ...initialForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らないので、確認の絵をそもそも撮れない。何が止まり・
   * 何が残り・戻せるのかを本文で読ませたいので、共通の `ConfirmDialog`
   * へ移した。
   */
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState('')
  /** 押したあとにアカウントが変わったか。変わっていたら実行させない。 */
  const accountChanged = pending !== null && pending.accountId !== selectedAccountId
  const loadRequestRef = useRef(0)

  const loadAutomations = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setError('')
    try {
      const res = await api.automations.list({ accountId: selectedAccountId || undefined })
      if (requestId !== loadRequestRef.current) return
      if (res.success) {
        setAutomations(res.data)
        setLoadStatus('ready')
      } else {
        setAutomations([])
        setLoadStatus('error')
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      setAutomations([])
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return

    void loadAutomations()

    return () => {
      // アカウント切替前の遅い応答を、次のアカウントの一覧へ混ぜない。
      loadRequestRef.current += 1
    }
  }, [accountLoading, loadAutomations])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }

    let parsedActions: AutomationAction[]
    let parsedConditions: Record<string, unknown>
    try {
      parsedActions = JSON.parse(form.actionsJson)
    } catch {
      setFormError('アクションのJSON形式が正しくありません')
      return
    }
    try {
      parsedConditions = JSON.parse(form.conditionsJson)
    } catch {
      setFormError('条件のJSON形式が正しくありません')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const res = await api.automations.create({
        name: form.name,
        description: form.description || null,
        eventType: form.eventType,
        actions: parsedActions,
        conditions: parsedConditions,
        priority: form.priority,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ ...initialForm })
        loadAutomations()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  /** 稼働の入れ替えそのもの。返事を確かめてから呼び出し元に戻す。 */
  const applyToggle = async (target: Automation) => {
    const res = await api.automations.update(target.id, { isActive: !target.isActive })
    if (!res.success) throw new Error(res.error)
  }

  const handleToggleActive = async (target: Automation) => {
    // 全アカウント共通のルールは、1つのアカウントの画面から触っても
    // すべてのアカウントに効く。ここだけ確認を挟む。
    if (target.lineAccountId === null) {
      setActionError('')
      setPending({ kind: 'toggle', automation: target, accountId: selectedAccountId })
      return
    }
    try {
      await applyToggle(target)
      await loadAutomations()
    } catch {
      setError('稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。')
    }
  }

  const handleDelete = (target: Automation) => {
    setActionError('')
    setPending({ kind: 'delete', automation: target, accountId: selectedAccountId })
  }

  /**
   * 窓の中の「実行する」。
   *
   * 処理中は受け付けない（二度押しで2回消えると、消えたことに気づけない）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。生のAPIエラーは
   * 「Internal server error」のように、運用者が次に何をすればよいか
   * 読み取れない。
   */
  const runPending = async () => {
    if (!pending || working || accountChanged) return
    setWorking(true)
    setActionError('')
    try {
      if (pending.kind === 'delete') {
        const res = await api.automations.delete(pending.automation.id)
        if (!res.success) throw new Error(res.error)
      } else {
        await applyToggle(pending.automation)
      }
      setPending(null)
      await loadAutomations()
    } catch {
      setActionError(
        pending.kind === 'delete'
          ? 'このルールを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : '稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <div>
      <div data-design="Head">
        <Header
          title="オートメーション"
          description="「〜のとき、〜する」を登録して自動で実行します。友だち一覧から手で実行したり、毎日決まった時刻に動かすこともできます。"
          action={
            <div className="flex flex-wrap gap-2">
              <Button href="/common-actions">共通アクションを見る</Button>
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                ルールを作成
              </Button>
              <Button href="/support">マニュアル</Button>
            </div>
          }
        />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">ルール</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {loadStatus === 'ready' ? automations.length : '—'}
            {loadStatus === 'ready' ? <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span> : null}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            稼働中 {loadStatus === 'ready' ? automations.filter((a) => a.isActive).length : '—'}
          </p>
        </div>
        {/* 実行の記録を残していない。何回動いたか、失敗したかが分からない。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月の実行</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">実行の記録がありません</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">失敗</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">実行の記録がありません</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">手動実行</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">友だち一覧から</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-canvas rounded-card border border-hairline p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規オートメーションを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 友だち追加時にウェルカムタグ付与"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                placeholder="ルールの説明 (省略可)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">イベントタイプ</label>
              <SelectField
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value as AutomationEventType })}
                options={eventTypeOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">アクション (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={6}
                placeholder='[{"type": "add_tag", "params": {"tagId": "..."}}]'
                value={form.actionsJson}
                onChange={(e) => setForm({ ...form, actionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">条件 (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={3}
                placeholder='{"tagId": "...", "operator": "equals"}'
                value={form.conditionsJson}
                onChange={(e) => setForm({ ...form, conditionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">優先度</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
              />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 rounded-control px-4 py-2 min-h-[44px] text-sm font-medium disabled:opacity-50"
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loadStatus === 'loading' ? (
        <ListState kind="loading" title="オートメーションを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="オートメーションを表示できませんでした"
          description="登録したルールは消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button variant="secondary" onClick={() => void loadAutomations()}>オートメーションを再読み込み</Button>}
        />
      ) : automations.length === 0 && !showCreate ? (
        <div className="bg-canvas rounded-card border border-hairline p-12 text-center">
          <p className="text-ink-faint">オートメーションがありません。「新規ルール」から作成してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {automations.map((automation) => (
            <div
              key={automation.id}
              className="bg-canvas rounded-card border border-hairline p-5 hover:shadow-md transition-shadow"
            >
              {/* Header row */}
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink leading-tight">{automation.name}</h3>
                <button
                  onClick={() => void handleToggleActive(automation)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    automation.isActive ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                  title={automation.isActive ? '有効 - クリックで無効化' : '無効 - クリックで有効化'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      automation.isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Description */}
              {automation.description && (
                <p className="text-xs text-ink-faint mb-3 line-clamp-2">{automation.description}</p>
              )}

              {/* Event type badge */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${eventTypeBadgeColor[automation.eventType]}`}>
                  {eventTypeLabelMap[automation.eventType]}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  automation.isActive ? 'bg-green-50 text-green-700' : 'bg-canvas-sunken text-ink-faint'
                }`}>
                  {automation.isActive ? '有効' : '無効'}
                </span>
                {/* lineAccountId === null = global; label it so the account-scoped
                   list cannot disguise an all-accounts rule as account-local. */}
                {automation.lineAccountId === null && (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                    title="全アカウントに適用されるオートメーションです"
                  >
                    全アカウント共通
                  </span>
                )}
              </div>

              {/* Meta info */}
              {(() => {
                const sendMsgWithTpl = automation.actions.filter(
                  (a) => a.type === 'send_message' && (a.params as { template_id?: string }).template_id,
                ).length
                return (
                  <div className="flex items-center gap-4 text-xs text-ink-faint mb-3">
                    <span>アクション: {automation.actions.length}件</span>
                    {sendMsgWithTpl > 0 && (
                      <a href="/templates" className="text-blue-600 hover:underline" title="template_id 参照を含む send_message action あり">
                        template×{sendMsgWithTpl}
                      </a>
                    )}
                    <span>優先度: {automation.priority}</span>
                  </div>
                )
              })()}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-hairline">
                <button
                  onClick={() => handleDelete(automation)}
                  className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-danger bg-danger-bg hover:bg-red-100 rounded-md transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === null
            ? ''
            : pending.kind === 'delete'
              ? `「${pending.automation.name}」を削除しますか？`
              : pending.automation.isActive
                ? `「${pending.automation.name}」を止めますか？`
                : `「${pending.automation.name}」を動かしますか？`
        }
        description={
          pending === null
            ? ''
            : pending.kind === 'delete'
              ? 'このルールの設定が消えます。すでに動いたぶん（付けたタグ・送ったメッセージ）はそのまま残り、取り消せません。この操作は取り消せません。'
              : pending.automation.isActive
                ? '止めているあいだ、このきっかけでは何も動きません。ルールの設定は残るので、あとから動かし直せます。'
                : 'これから起きるきっかけで動き始めます。止めているあいだに起きたぶんは、さかのぼって動きません。あとから止められます。'
        }
        confirmLabel={
          pending === null
            ? '実行する'
            : pending.kind === 'delete'
              ? '削除する'
              : pending.automation.isActive
                ? '止める'
                : '動かす'
        }
        /* 取り消せるのは稼働の切り替えだけ。赤は本当に戻せない削除に取っておく。
           戻せる操作にも赤を付けると、赤が「危ない」を意味しなくなる。 */
        destructive={pending?.kind === 'delete'}
        busy={working}
        error={actionError}
        /* アカウントが変わっているあいだは実行のボタンそのものを出さない
           （`ConfirmDialog` は `onConfirm` が `undefined` だとボタンを出さない）。 */
        onConfirm={accountChanged ? undefined : () => void runPending()}
        onCancel={() => {
          if (working) return
          setPending(null)
          setActionError('')
        }}
      >
        {pending !== null && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>
              きっかけ：{eventTypeLabelMap[pending.automation.eventType]} ／ アクション{' '}
              {pending.automation.actions.length}件
            </p>
            {pending.automation.lineAccountId === null && (
              <p className="text-warning font-medium">
                全アカウント共通のルールです。
                {pending.kind === 'delete'
                  ? 'すべてのアカウントから消えます。'
                  : 'すべてのアカウントに効きます。'}
              </p>
            )}
            {/* 実行の記録を持っていない。「0回」と書くと、動いていないのか
                数えていないのか区別が付かなくなる。 */}
            <p className="text-ink-faint text-xs">
              このルールが何回動いたかは記録していないため、ここには出せません。
            </p>
            {accountChanged && (
              <p className="text-warning font-medium">
                押したあとにLINEアカウントが切り替わりました。この窓を閉じて、いまのアカウントの一覧から選び直してください。
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
