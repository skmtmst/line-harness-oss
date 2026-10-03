'use client'

/*
 * ★V8-B 外部連携のこちらで受け取る（板 `gW0F2`・閲覧のみ `l5SRfT`）。
 *
 * v7 の器（`page.tsx` の作る窓＋`webhook-overviews.tsx` の
 * `IncomingOverview`）とは別の器。データの口・動き・文言は v7 と同じ。
 * 受け取り口の作り替え・合言葉の入れ替えは本人確認が要る（v7 と同じ）。
 * v7 を直す必要が出たら `page.tsx`・`webhook-overviews.tsx` 側も同じ判断を入れる。
 */
import { useCallback, useEffect, useState } from 'react'
import type { IncomingWebhook } from '@line-crm/shared'
import { ApiError, api, type IncomingWebhookDetail, type IncomingWebhookTestResult, type IncomingWebhookUnmatchedItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { describeApiFailure } from '@/components/shared/api-error-message'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { inputClass } from '@/components/shared/form-controls'
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'
import styles from './webhooks-v8-incoming.module.css'
import { formatDateTime } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')

/* R401: 未照合の箱の1回の読み取り件数。一覧APIの既定と同じ50。 */
const UNMATCHED_PAGE_SIZE = 50

/*
 * 受け取る設定の「どこから来るか」の見本（v7 の SOURCE_PRESETS と同じ）。
 * 値は今までどおりの文字列なので、口も保存の形も変えない。
 * 見本に無いものは「その他」を選べば自由に書ける。
 */
const SOURCE_PRESETS = [
  { value: 'line', label: 'LINE公式アカウント', hint: '友だち追加やメッセージの通知を受け取ります' },
  { value: 'booking', label: '予約サービス', hint: '予約の確定・変更・取り消しを受け取ります' },
  { value: 'form', label: 'アンケートツール', hint: '回答が届いたことを受け取ります' },
  { value: 'ec', label: 'ECサイト', hint: '注文や発送の知らせを受け取ります' },
  { value: 'payment', label: '決済サービス', hint: '支払いの成否を受け取ります' },
] as const

/** 見本に無い「その他」を選んだときだけ、自由入力に切り替える印。 */
const SOURCE_OTHER = '__other__'

function endpointUrl(id: string): string {
  return `${API_BASE}/api/webhooks/incoming/${id}/receive`
}

function identityMatchingLabel(detail: IncomingWebhookDetail | null): string {
  if (!detail || detail.identityMatching.methods.length === 0) return '照合しない'
  return detail.identityMatching.methods.map((method) => ({
    harness_friend_id: '友だちIDで探す',
    external_customer_id: '外部サービスのお客様IDで探す',
    verified_email: 'メールアドレスで探す',
    verified_phone: '電話番号で探す',
  })[method.kind]).join('、')
}

function notFoundLabel(value: IncomingWebhookDetail['identityMatching']['onNotFound'] | undefined): string {
  return ({
    do_nothing: '何もしない',
    unmatched_box: '未照合として確認する',
    create_candidate: '友だち候補を作る',
  } as const)[value ?? 'do_nothing']
}

function identityKindLabel(kind: string): string {
  return ({
    harness_friend_id: '友だちID',
    external_customer_id: '外部サービスのお客様ID',
    verified_email: 'メールアドレス',
    verified_phone: '電話番号',
  } as Record<string, string>)[kind] ?? kind
}

function incomingActionLabel(kind: string): string {
  return ({
    common_action: '共通アクションを動かす',
    tag: 'タグを付ける',
    friend_field: '友だち情報を更新する',
    support_mark: '対応マークを付ける',
    template: 'テンプレートを送る',
    scenario: 'シナリオを開始する',
    reminder: 'リマインダを開始する',
    conversion: '成果を記録する',
    mileage_rule: 'マイルを付ける',
    score_rule: 'スコアを更新する',
    outgoing_webhook: '別のサービスへ知らせる',
    operator_notification: '担当者へ知らせる',
  } as Record<string, string>)[kind] ?? '保存済みの処理を動かす'
}

function formatReceivedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '受信時刻不明'
  return formatDateTime(date)
}

function maskedSampleText(fields: NonNullable<IncomingWebhookDetail['latestSample']>['fields']): string {
  const rows = fields.map((field) => {
    const name = field.path.replace(/^\$\.?/, '') || '$'
    return `"${name}": "${field.maskedValue}"`
  })
  return `{ ${rows.join(', ')} }`
}

function maskedEndpoint(value: string): string {
  const parts = value.split('/')
  const id = parts.pop() ?? ''
  return `${parts.join('/')}/${id.slice(0, 4)}•••`
}

function sourceName(value: string): string {
  return {
    booking: '予約サービス',
    form: 'アンケートツール',
    ec: 'ECサイト',
    line: 'LINE公式アカウント',
    payment: '決済サービス',
  }[value] ?? value ?? '送信元未設定'
}

export default function WebhooksV8Incoming({ onCounts }: { onCounts?: (total: number | null) => void }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<IncomingWebhook[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IncomingWebhookDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  /*
    人が見つからなかった届物の箱(#939 N-367)。
    「未照合として確認する」「友だち候補を作る」を選んだ口だけ使う。
  */
  const [unmatched, setUnmatched] = useState<IncomingWebhookUnmatchedItem[]>([])
  const [unmatchedStatus, setUnmatchedStatus] = useState<LoadStatus>('ready')
  const [unmatchedTotal, setUnmatchedTotal] = useState<number | null>(null)
  const [unmatchedShown, setUnmatchedShown] = useState(UNMATCHED_PAGE_SIZE)
  const [unmatchedReloadKey, setUnmatchedReloadKey] = useState(0)
  const [unmatchedMoreBusy, setUnmatchedMoreBusy] = useState(false)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  /*
   * R399: 行の操作が失敗したときの理由と次の行動。操作は1件ずつ直列
   * （dismissingId）なので置き場は1つで足りる。
   * R401: 50件超えは shown 件ずつ読み足す。total は空表示の判定にも使う。
   */
  const [unmatchedActionError, setUnmatchedActionError] = useState<{ id: string; message: string } | null>(null)
  /*
    S (#939 機能26): 届いたつもりで試す窓。見本のJSONを入れて
    「どの人に届くか・何が動くか」を確かめる。実行はしない。
  */
  const [testOpen, setTestOpen] = useState(false)
  const [testJson, setTestJson] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<IncomingWebhookTestResult | null>(null)
  // 受け取り口の作り替え・合言葉の入れ替えは統括だけ（R32）。
  const [role, setRole] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState('')
  // 作る窓・鍵の入れ替え窓・削除の確認・一度だけ見せる合言葉。
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', sourceType: '', secret: '' })
  const [sourceIsOther, setSourceIsOther] = useState(false)
  const [createFieldError, setCreateFieldError] = useState<{ name?: string; secret?: string }>({})
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string; accountId: string } | null>(null)
  const [rotateSecret, setRotateSecret] = useState('')
  const [rotateBusy, setRotateBusy] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; accountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [copied, setCopied] = useState(false)

  const canManage = role === null || role === 'owner'
  const canResolveUnmatched = role === null || role === 'owner' || role === 'admin'
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const selectedDetailId = selected?.id ?? null

  const load = useCallback(async () => {
    const accountId = selectedAccountId
    setItems([])
    if (!accountId) {
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const res = await api.webhooks.incoming.list(accountId)
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // 外枠のタブの件数は、この一覧と同じ取得から数える（#980）。
  useEffect(() => {
    if (onCounts) onCounts(status === 'ready' ? items.length : null)
  }, [items, onCounts, status])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [items, selectedId])

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    if (!selectedDetailId || !selectedAccountId) {
      setDetailStatus('ready')
      return () => { cancelled = true }
    }
    setDetailStatus('loading')
    void api.webhooks.incoming.detail(selectedDetailId, selectedAccountId)
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setDetailStatus('error')
          return
        }
        setDetail(response.data)
        setDetailStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setDetailStatus('error')
      })
    return () => { cancelled = true }
  }, [detailReloadKey, selectedAccountId, selectedDetailId])

  /*
    箱の中身は詳細が読めたときに一緒に読む。「何もしない」を選んでいる口でも、
    以前の選択で溜まった届物があれば見せる（R400）。
    R401: shown 件ずつ読む。処理が終わるたび読み直して不足分を補充するので、
    件数の勘定は手元で引かずサーバー（total・詳細の件数）に任せる。
  */
  useEffect(() => {
    let cancelled = false
    if (!selectedDetailId || !selectedAccountId || detailStatus !== 'ready') return
    const webhookId = selectedDetailId
    const accountId = selectedAccountId
    const limit = unmatchedShown
    // 既に並んでいる読み直しは静かに（R401）。初回と失敗後は帯を出す。
    if (unmatched.length === 0) setUnmatchedStatus('loading')
    void api.webhooks.incoming.unmatched(webhookId, accountId, undefined, { limit })
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setUnmatchedStatus('error')
          return
        }
        setUnmatched(response.data)
        setUnmatchedTotal(response.total ?? null)
        setUnmatchedStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setUnmatchedStatus('error')
      })
      .finally(() => {
        if (!cancelled) setUnmatchedMoreBusy(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailStatus, selectedAccountId, selectedDetailId, unmatchedShown, unmatchedReloadKey])

  /* 受け取り口が変わったら箱の表示を捨てる（R401: 古い50件を残さない）。 */
  useEffect(() => {
    setUnmatched([])
    setUnmatchedTotal(null)
    setUnmatchedShown(UNMATCHED_PAGE_SIZE)
    setUnmatchedActionError(null)
    setUnmatchedStatus('ready')
  }, [selectedAccountId, selectedDetailId])

  const reloadUnmatchedBox = () => {
    setUnmatchedReloadKey((key) => key + 1)
    setDetailReloadKey((key) => key + 1)
  }

  /*
   * R399: 403/409/500/通信断で未処理Promiseを残さず、行に理由と次の行動を出す。
   * 成功時は手元で引かず読み直す（R401: 残件と空表示の矛盾を防ぐ）。
   */
  const resolveUnmatched = async (
    item: IncomingWebhookUnmatchedItem,
    payload: { action: 'dismiss' } | { action: 'link'; friendId: string },
  ) => {
    const accountId = selectedAccountId
    if (!accountId || dismissingId !== null) return
    setDismissingId(item.id)
    setUnmatchedActionError(null)
    try {
      const res = await api.webhooks.incoming.resolveUnmatched(item.id, accountId, payload)
      if (!res.success) {
        setUnmatchedActionError({
          id: item.id,
          message: res.error || '保存できませんでした。一覧を読み直してから、もう一度お試しください。',
        })
        return
      }
      reloadUnmatchedBox()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        reloadUnmatchedBox()
        setUnmatchedActionError({ id: item.id, message: 'すでに処理済みです。最新の状態を読み直しました。' })
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setUnmatchedActionError({ id: item.id, message: 'この操作は統括または管理者だけができます。必要なときは統括に頼んでください。' })
        return
      }
      if (caught instanceof ApiError) {
        setUnmatchedActionError({
          id: item.id,
          message: describeApiFailure(caught, '確認', {
            forbidden: 'この操作は統括または管理者だけができます。必要なときは統括に頼んでください。',
          }),
        })
        return
      }
      reloadUnmatchedBox()
      setUnmatchedActionError({ id: item.id, message: '結果が分かりませんでした。一覧を読み直しました。残っていれば、もう一度お試しください。' })
    } finally {
      setDismissingId(null)
    }
  }

  const runIncomingTest = async () => {
    const accountId = selectedAccountId
    if (!accountId || !selectedDetailId || testBusy) return
    let payload: unknown
    try {
      payload = JSON.parse(testJson) as unknown
    } catch {
      setTestError('JSONの形が正しくありません。見本を確かめてください。')
      return
    }
    setTestBusy(true)
    setTestError('')
    try {
      const res = await api.webhooks.incoming.test(selectedDetailId, accountId, payload)
      if (!res.success) {
        setTestError(res.error)
        setTestResult(null)
        return
      }
      setTestResult(res.data)
    } catch (caught) {
      // 試す口は管理者も使える。失敗は原因どおりに（R32）。
      setTestError(describeApiFailure(caught, '試し', {
        forbidden: 'この操作を行う権限がありません。統括に頼んでください。',
      }))
      setTestResult(null)
    } finally {
      setTestBusy(false)
    }
  }

  const toggleSelected = async () => {
    const accountId = selectedAccountId
    if (!accountId || !selected || toggling) return
    setToggling(true)
    setToggleError('')
    try {
      const res = await api.webhooks.incoming.update(selected.id, accountId, { isActive: !selected.isActive })
      if (!res.success) throw new Error(res.error)
      await load()
      setDetailReloadKey((key) => key + 1)
    } catch (caught) {
      // 切り替えは統括だけの操作。権限不足は通信の失敗と分けて案内する（R32）。
      const forbidden = caught instanceof ApiError && caught.status === 403
      setToggleError(forbidden
        ? '統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。'
        : '切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。')
    } finally {
      setToggling(false)
    }
  }

  const runCreate = async (stepUpToken?: string) => {
    const accountId = selectedAccountId
    if (!accountId || creating) return
    const fieldError: { name?: string; secret?: string } = {}
    if (!createForm.name.trim()) fieldError.name = '名前を入れてください'
    if (createForm.secret.length < MIN_SECRET_LENGTH) fieldError.secret = `合言葉は${MIN_SECRET_LENGTH}文字以上にしてください`
    setCreateFieldError(fieldError)
    if (fieldError.name || fieldError.secret) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.webhooks.incoming.create({
        lineAccountId: accountId,
        name: createForm.name.trim(),
        sourceType: createForm.sourceType || undefined,
        secret: createForm.secret,
      }, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setCreateOpen(false)
      setCreateForm({ name: '', sourceType: '', secret: '' })
      setSourceIsOther(false)
      // 合言葉はこの場で一度だけ見せる。写したら忘れる。
      setCreatedSecret({ name: createForm.name.trim(), secret: createForm.secret })
      setSecretCopied(false)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '受け取り口を登録する', retry: (token) => runCreate(token) })
        return
      }
      setCreateError(caught instanceof Error ? caught.message : '受け取り口を作れませんでした。確かめてから、もう一度お試しください。')
    } finally {
      setCreating(false)
    }
  }

  const runRotate = async (stepUpToken?: string) => {
    const accountId = selectedAccountId
    if (!accountId || !rotateTarget || rotateBusy) return
    // 開いた時点のアカウントを固定する（d23b R420）。
    if (rotateTarget.accountId !== accountId) {
      setRotateError('LINEアカウントが切り替わりました。窓を閉じて、もう一度開き直してください。')
      return
    }
    if (rotateSecret.length < MIN_SECRET_LENGTH) {
      setRotateError(`合言葉は${MIN_SECRET_LENGTH}文字以上にしてください`)
      return
    }
    setRotateBusy(true)
    setRotateError('')
    try {
      const res = await api.webhooks.incoming.update(
        rotateTarget.id, accountId, { secret: rotateSecret }, stepUpToken,
      )
      if (!res.success) throw new Error(res.error)
      setRotateTarget(null)
      setRotateSecret('')
      setDetailReloadKey((key) => key + 1)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '合言葉を更新する', retry: (token) => runRotate(token) })
        return
      }
      setRotateError('合言葉を更新できませんでした。統括に頼んでください。')
    } finally {
      setRotateBusy(false)
    }
  }

  const runDelete = async () => {
    const accountId = selectedAccountId
    if (!accountId || !deleteTarget || deleting) return
    // 開いた時点のアカウントを固定する（d23b R420）。
    if (deleteTarget.accountId !== accountId) {
      setDeleteError('LINEアカウントが切り替わりました。窓を閉じて、もう一度開き直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.incoming.delete(deleteTarget.id, accountId)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await load()
    } catch {
      setDeleteError('この受け取り口を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const copyUrl = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(endpointUrl(selected.id))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (status === 'loading') {
    return <ListState kind="loading" title="こちらで受け取る設定を読み込んでいます" />
  }
  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="こちらで受け取る設定を表示できませんでした"
        description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へ。"
        action={<Button onClick={() => void load()}>設定を再読み込み</Button>}
      />
    )
  }

  const dialogs = (
    <>
      <Dialog
        open={createOpen}
        title="受け取り口を作る"
        description="相手のサービスから知らせを受け取るURLを作ります。合言葉は相手側の設定にも同じものを入れてください。"
        onCancel={() => { if (!creating) setCreateOpen(false) }}
        footer={
          <div className={styles.dialogFooter}>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>やめる</Button>
            <Button variant="primary" onClick={() => void runCreate()} disabled={creating} busy={creating} busyLabel="作っています…">作る</Button>
          </div>
        }
      >
        <div className={styles.formStack}>
          <div>
            <label className={styles.fieldLabel} htmlFor="incoming-create-name">名前</label>
            <input
              id="incoming-create-name"
              className={inputClass}
              value={createForm.name}
              onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
              placeholder="例：予約サービスの予約通知"
            />
            {createFieldError.name ? <p className={styles.fieldError} role="alert">{createFieldError.name}</p> : null}
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="incoming-create-source">どこから来るか</label>
            <Select
              aria-label="どこから来るか"
              value={sourceIsOther ? SOURCE_OTHER : createForm.sourceType}
              options={[
                { value: '', label: '選んでください' },
                ...SOURCE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
                { value: SOURCE_OTHER, label: 'その他（自由に入力）' },
              ]}
              onChange={(next) => {
                if (next === SOURCE_OTHER) { setSourceIsOther(true); setCreateForm({ ...createForm, sourceType: '' }); return }
                setSourceIsOther(false)
                setCreateForm({ ...createForm, sourceType: next })
              }}
            />
            {sourceIsOther ? (
              <input
                className={inputClass}
                value={createForm.sourceType}
                onChange={(event) => setCreateForm({ ...createForm, sourceType: event.target.value })}
                placeholder="例：自社の受注システム"
                aria-label="送信元の自由入力"
              />
            ) : (
              <p className={styles.fieldHint}>
                {SOURCE_PRESETS.find((preset) => preset.value === createForm.sourceType)?.hint ?? '見本から選ぶと、後の設定が楽になります。'}
              </p>
            )}
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="incoming-create-secret">合言葉（相手にも同じものを入れてもらう）</label>
            <div className={styles.secretRow}>
              <input
                id="incoming-create-secret"
                className={inputClass}
                value={createForm.secret}
                onChange={(event) => setCreateForm({ ...createForm, secret: event.target.value })}
                placeholder={`${MIN_SECRET_LENGTH}文字以上`}
              />
              <Button variant="secondary" onClick={() => setCreateForm({ ...createForm, secret: generateSecret() })}>自動で作る</Button>
            </div>
            {createFieldError.secret ? <p className={styles.fieldError} role="alert">{createFieldError.secret}</p> : null}
            <p className={styles.fieldHint}>作るときに本人確認が出ます。</p>
          </div>
          {createError ? <p className={styles.panelError} role="alert">{createError}</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={rotateTarget !== null}
        title={rotateTarget ? `「${rotateTarget.name}」の合言葉を更新する` : ''}
        description="新しい合言葉に変えます。相手側の設定も新しい合言葉に変えてください。入れ替え直後は前の合言葉もしばらく使えます。"
        onCancel={() => {
          setRotateTarget(null)
          setRotateSecret('')
          setRotateError('')
        }}
        footer={
          <div className={styles.dialogFooter}>
            <Button variant="secondary" onClick={() => { setRotateTarget(null); setRotateSecret(''); setRotateError('') }} disabled={rotateBusy}>やめる</Button>
            <Button variant="primary" onClick={() => void runRotate()} disabled={rotateBusy} busy={rotateBusy} busyLabel="更新しています…">合言葉を更新する</Button>
          </div>
        }
      >
        <label className={styles.fieldLabel} htmlFor="incoming-rotate-secret">新しい合言葉</label>
        <div className={styles.secretRow}>
          <input
            id="incoming-rotate-secret"
            className={inputClass}
            value={rotateSecret}
            onChange={(event) => setRotateSecret(event.target.value)}
            placeholder={`${MIN_SECRET_LENGTH}文字以上`}
          />
          <Button variant="secondary" onClick={() => setRotateSecret(generateSecret())}>自動で作る</Button>
        </div>
        {rotateError ? <p className={styles.panelError} role="alert">{rotateError}</p> : null}
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`受け取り口「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="この受け取り口のURLは使えなくなり、これから届く通知は受け取れなくなります。すでに受け取った記録は残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />

      <Dialog
        open={createdSecret !== null}
        title="合言葉を写してください"
        description={`「${createdSecret?.name ?? ''}」の合言葉です。この場で一度だけ見せます。相手側の設定にも同じものを入れてください。`}
        onCancel={() => setCreatedSecret(null)}
        footer={
          <div className={styles.dialogFooter}>
            <Button
              variant="secondary"
              onClick={() => {
                if (createdSecret) void navigator.clipboard.writeText(createdSecret.secret).then(() => setSecretCopied(true)).catch(() => {})
              }}
            >
              {secretCopied ? '写しました' : '合言葉をコピー'}
            </Button>
            <Button variant="primary" onClick={() => setCreatedSecret(null)}>閉じる</Button>
          </div>
        }
      >
        <div className={styles.secretBox}>
          <p className={styles.secretLabel}>合言葉</p>
          <code className={styles.secretValue}>{createdSecret?.secret ?? ''}</code>
        </div>
      </Dialog>

      {/*
        S (#939 機能26): 届いたつもりで試す窓。見本のJSONで「どの人に届くか・
        何が動くか」を確かめるだけで、実際の処理は動かない。閉じ方は右上の×。
      */}
      <Dialog
        open={testOpen}
        title="届いたつもりで試す"
        description="見本のJSONで、どの人に届くかと何が動くかを確かめます。実際の処理は動きません。"
        onCancel={() => setTestOpen(false)}
        footer={
          <div className={styles.dialogFooter}>
            <Button variant="primary" onClick={() => void runIncomingTest()} disabled={testBusy || !testJson.trim()} busy={testBusy} busyLabel="試しています…">試す</Button>
          </div>
        }
      >
        <label className={styles.fieldLabel} htmlFor="incoming-test-json">
          届いたつもりのJSON
        </label>
        <textarea
          id="incoming-test-json"
          className={styles.testArea}
          value={testJson}
          onChange={(event) => setTestJson(event.target.value)}
          placeholder='{"friendId": "…"}'
        />
        {testError ? <p className={styles.panelError} role="alert">{testError}</p> : null}
        {testResult ? (
          <div className={styles.testResult}>
            <div>
              <strong className={styles.testResultTitle}>だれに届くか</strong>
              <p className={styles.panelLead}>
                {testResult.match.status === 'matched'
                  ? '1人の友だちに一致しました'
                  : testResult.match.status === 'ambiguous'
                    ? `同じ値の友だちが${testResult.match.friendIds.length}人います。実際に届くと保留になり、人が選びます。`
                    : '一致する友だちがいません'}
              </p>
            </div>
            <div>
              <strong className={styles.testResultTitle}>動く予定の処理</strong>
              {testResult.actions.length > 0 ? (
                <ul className={styles.testActionList}>
                  {testResult.actions.map((action) => (
                    <li key={action.refIndex} className={styles.testActionItem}>
                      <span className={styles.testActionName}>{incomingActionLabel(action.refKind)}：{action.displayName}</span>
                      {action.ok
                        ? <span className={styles.testActionMeta}>({action.plan?.length ?? 0}件の処理)</span>
                        : <span className={styles.testActionError}>{action.error}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.panelLead}>動く処理はまだ設定されていません</p>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )

  return (
    <div className={styles.split}>
      <div className={styles.rail}>
        {canManage ? (
          <Button className={styles.createButton} onClick={() => {
            setCreateForm({ name: '', sourceType: '', secret: generateSecret() })
            setSourceIsOther(false)
            setCreateFieldError({})
            setCreateError('')
            setCreateOpen(true)
          }}>
            ＋ 受け取り口を作る
          </Button>
        ) : (
          <Button className={styles.createButton} type="button" variant="secondary" disabled title="閲覧のみのため作れません">
            ＋ 受け取り口を作る
          </Button>
        )}
        <p className={styles.railTitle}>受け取り口</p>
        <ul className={styles.railList}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-current={selected?.id === item.id ? 'true' : undefined}
                className={selected?.id === item.id ? `${styles.railRow} ${styles.railRowActive}` : styles.railRow}
              >
                <StatusBadge tone={item.isActive ? 'success' : 'neutral'} size="compact">
                  {item.isActive ? '動' : '止'}
                </StatusBadge>
                <span className={styles.railName} title={item.name}>{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 ? (
          <p className={styles.railNote}>
            {canManage
              ? 'まだ受け取り口がありません。「＋ 受け取り口を作る」から作成してください。'
              : 'まだ受け取り口がありません。受け取り口の作成は統括に頼んでください。'}
          </p>
        ) : null}
      </div>

      <div className={styles.main}>
        {selected ? (
          <>
            <section className={styles.panel} aria-label="受け取り口の詳細">
              <div className={styles.panelHead}>
                <div>
                  <h2 className={styles.panelTitle}>{selected.name}</h2>
                  <p className={styles.panelLead}>相手のサービスの「Webhook URL」に、下のURLを貼ってください。</p>
                </div>
                <StatusBadge tone={selected.isActive ? 'success' : 'neutral'}>
                  {selected.isActive ? '動いています' : '止めています'}
                </StatusBadge>
              </div>
              <div className={styles.urlBox}>
                <code className={styles.urlValue}>{endpointUrl(selected.id)}</code>
                <Button variant="secondary" onClick={() => void copyUrl()}>
                  {copied ? '写しました' : 'コピー'}
                </Button>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>だれの出来事か（人の見分けかた）</dt>
                  <dd>
                    {detailStatus === 'loading'
                      ? '読み込んでいます'
                      : detailStatus === 'error'
                        ? '表示できませんでした'
                        : identityMatchingLabel(detail)}
                  </dd>
                </div>
                <div>
                  <dt>見つからなかったとき</dt>
                  <dd>
                    {detailStatus === 'loading'
                      ? '読み込んでいます'
                      : detailStatus === 'error'
                        ? '表示できませんでした'
                        : notFoundLabel(detail?.identityMatching.onNotFound)}
                  </dd>
                </div>
                <div>
                  <dt>合言葉（相手にも同じものを入れてもらう）</dt>
                  <dd><StatusBadge tone={selected.hasSecret ? 'success' : 'warning'} size="compact">{selected.hasSecret ? '設定済み（再表示しません）' : '未設定'}</StatusBadge></dd>
                  {/* S: 入れ替えたばかりなら、前の合言葉が切れる時刻を示す。 */}
                  {detail?.previousSecretUsableUntil ? (
                    <dd className={styles.factNote}>
                      前の合言葉は {formatReceivedAt(detail.previousSecretUsableUntil)} まで使えます
                    </dd>
                  ) : null}
                </div>
              </dl>
              <div className={styles.panelButtons}>
                {canManage ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => void toggleSelected()}
                      disabled={toggling || (!selected.hasSecret && !selected.isActive)}
                      busy={toggling}
                      busyLabel={selected.isActive ? '止めています…' : '動かしています…'}
                      title={!selected.hasSecret && !selected.isActive ? '合言葉を設定してから動かしてください' : undefined}
                    >
                      {selected.isActive ? '止める' : '動かす'}
                    </Button>
                    <Button variant="secondary" onClick={() => {
                      // 開いた時点のアカウントを固定する（d23b R420）。
                      setRotateTarget({ id: selected.id, name: selected.name, accountId: selectedAccountId ?? '' })
                      setRotateSecret('')
                      setRotateError('')
                    }}>合言葉を更新する</Button>
                  </>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTestJson(detail?.latestSample
                      ? '{\n  "friendId": "ここに届くデータの形を入れてください"\n}'
                      : '')
                    setTestResult(null)
                    setTestError('')
                    setTestOpen(true)
                  }}
                >
                  届いたつもりで試す
                </Button>
                {canManage ? (
                  <Button variant="secondary" onClick={() => {
                    // 開いた時点のアカウントを固定する（d23b R420）。
                    setDeleteTarget({ id: selected.id, name: selected.name, accountId: selectedAccountId ?? '' })
                    setDeleteError('')
                  }}>削除する</Button>
                ) : null}
              </div>
              {toggleError ? <p className={styles.panelError} role="alert">{toggleError}</p> : null}
              {canManage ? null : (
                <p className={styles.panelNote}>止める・合言葉の更新・削除は統括だけができます。</p>
              )}
            </section>

            <section className={styles.panel} aria-label="届いたらすること">
              <h2 className={styles.panelTitle}>届いたらすること</h2>
              {detailStatus === 'loading' ? (
                <p className={styles.panelLead}>保存されている処理を読み込んでいます。</p>
              ) : detailStatus === 'error' ? (
                <ListState
                  kind="error"
                  title="届いた後の処理を表示できませんでした"
                  description="設定は消えていません。詳細だけをもう一度読み込めます。"
                  action={<Button onClick={() => setDetailReloadKey((key) => key + 1)}>詳細を再読み込み</Button>}
                />
              ) : detail && detail.actions.length > 0 ? (
                <ul className={styles.actionList}>
                  {detail.actions.map((action, index) => (
                    <li key={`${action.refKind}-${index}`} className={styles.actionItem}>
                      <strong className={styles.actionName}>{incomingActionLabel(action.refKind)}</strong>
                      <span className={styles.actionDetail}>{action.displayName}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.panelLead}>届いた後に動かす処理は、まだ設定されていません。</p>
              )}
            </section>

            {/*
              N-367: 「未照合として確認する」「友だち候補を作る」を選んだ口に
              届いて、人が見つからなかったものをここへ置く。選び方が変わっても
              溜まった届物は残るので、残っている限り見せる。
              R400: 「何もしない」を選んでいても、未確認が残っていれば欄を出す。
              読めなかったときも欄ごと消さず、理由と読み直しを出す。
            */}
            {detail && (detail.identityMatching.onNotFound !== 'do_nothing'
              || unmatched.length > 0
              || (detail.pendingUnmatched ?? 0) > 0
              || unmatchedStatus === 'error') ? (
              <section className={styles.panel} aria-label="人が見つからなかった届物">
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>人が見つからなかった届物</h2>
                  {(detail.pendingUnmatched ?? 0) > 0 ? (
                    <StatusBadge tone="warning" size="compact">
                      未確認 {detail.pendingUnmatched}件
                    </StatusBadge>
                  ) : null}
                </div>
                {unmatchedStatus === 'loading' ? (
                  <p className={styles.panelLead}>届物を読み込んでいます。</p>
                ) : unmatchedStatus === 'error' ? (
                  <div>
                    <p className={styles.panelLead}>届物を表示できませんでした。確認待ちの届物は消えていません。</p>
                    <div className={styles.panelButtons}>
                      <Button variant="secondary" onClick={() => setUnmatchedReloadKey((key) => key + 1)}>
                        届物だけ読み直す
                      </Button>
                    </div>
                  </div>
                ) : (unmatchedTotal ?? detail.pendingUnmatched ?? unmatched.length) === 0 ? (
                  <p className={styles.panelLead}>いま確認が必要な届物はありません。</p>
                ) : (
                  <>
                    <ul className={styles.unmatchedList}>
                      {unmatched.map((item) => (
                        <li key={item.id} className={styles.unmatchedItem}>
                          <div className={styles.unmatchedBody}>
                            <strong className={styles.unmatchedTitle}>
                              {item.kind === 'candidate'
                                ? '友だち候補'
                                : item.kind === 'ambiguous'
                                  ? '2人以上に一致'
                                  : '未照合'}・{formatReceivedAt(item.receivedAt)}
                            </strong>
                            <span className={styles.unmatchedDetail}>
                              {item.identityAttempts.length > 0
                                ? item.identityAttempts.map((attempt) => `${identityKindLabel(attempt.kind)}：${attempt.value}`).join('、')
                                : '照合に使える値が届いていません'}
                            </span>
                            {/*
                              S: 同じ値で2人以上に一致した届物は自動では動かさない。
                              どの友だちか候補から人が選ぶ。どれでもなければ閉じる。
                            */}
                            {item.kind === 'ambiguous' && item.candidates.length > 0 && canResolveUnmatched ? (
                              <ul className={styles.candidateList}>
                                {item.candidates.map((candidate) => (
                                  <li key={candidate.friendId} className={styles.candidateRow}>
                                    <span className={styles.candidateName}>{candidate.displayName ?? candidate.friendId}</span>
                                    <Button
                                      variant="secondary"
                                      disabled={dismissingId !== null}
                                      onClick={() => void resolveUnmatched(item, { action: 'link', friendId: candidate.friendId })} busy={dismissingId === item.id} busyLabel="結び付けています…">この人に結び付ける
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          {canResolveUnmatched ? (
                            <Button
                              variant="secondary"
                              disabled={dismissingId !== null}
                              onClick={() => void resolveUnmatched(item, { action: 'dismiss' })} busy={dismissingId === item.id} busyLabel="閉じています…">
                              {item.kind === 'ambiguous' ? 'どれでもない' : '確認した'}
                            </Button>
                          ) : (
                            <p className={styles.panelNote}>結び付け・確認は統括または管理者に頼んでください。</p>
                          )}
                          {/*
                            R399: 失敗の理由と次の行動は操作した行に出す。
                            失敗・警告の文は ? に入れず行に書く（直し方が要るため）。
                          */}
                          {unmatchedActionError && unmatchedActionError.id === item.id ? (
                            <p role="alert" className={styles.panelError}>{unmatchedActionError.message}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {/*
                      R401: 残りがあれば「ほかN件」と次への導線を出す。
                      空表示は残件0のときだけ（total が無い古い応答では件数表示で代用）。
                    */}
                    {(unmatchedTotal ?? detail.pendingUnmatched ?? 0) > unmatched.length ? (
                      <div className={styles.moreRow}>
                        <p className={styles.panelNote}>
                          ほか{(unmatchedTotal ?? detail.pendingUnmatched ?? 0) - unmatched.length}件あります。
                        </p>
                        <Button
                          variant="secondary"
                          disabled={unmatchedMoreBusy}
                          onClick={() => {
                            setUnmatchedMoreBusy(true)
                            setUnmatchedShown((shown) => shown + UNMATCHED_PAGE_SIZE)
                          }} busy={unmatchedMoreBusy} busyLabel="読み込んでいます…">さらに表示
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            <section className={styles.panel} aria-label="届いたデータの見かた">
              <h2 className={styles.panelTitle}>届いたデータの見かた</h2>
              {detailStatus === 'loading' ? (
                <p className={styles.panelLead}>いちばん最近届いた見本を読み込んでいます。</p>
              ) : detailStatus === 'error' ? (
                <p className={styles.panelLead}>見本を表示できませんでした。詳細の再読み込みをお試しください。</p>
              ) : detail?.latestSample ? (
                <>
                  <p className={styles.panelLead}>
                    いちばん最近届いたものです。値は安全のため隠しています。項目名を差し込みに使えます。
                  </p>
                  <p className={styles.panelNote}>
                    {formatReceivedAt(detail.latestSample.receivedAt)} に届いたもの
                  </p>
                  <pre className={styles.samplePre}>{maskedSampleText(detail.latestSample.fields)}</pre>
                  <div className={styles.tokenRow}>
                    {detail.templateFields.map((field) => (
                      <code key={field.token} className={styles.token}>
                        {field.token}
                      </code>
                    ))}
                  </div>
                  {detail.latestSample.truncated ? (
                    <p className={styles.panelNote}>項目が多いため、先頭50件まで表示しています。</p>
                  ) : null}
                </>
              ) : (
                <div className={styles.emptySample}>
                  まだ受け取ったデータはありません
                </div>
              )}
            </section>

            {items.length > 1 ? (
              <section aria-label="そのほかの受け取り口">
                <h2 className={styles.otherTitle}>そのほかの受け取り口</h2>
                <div className={styles.otherGrid}>
                  {items.filter((item) => item.id !== selected.id).map((item) => (
                    <div key={item.id} className={styles.otherCard}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={styles.otherButton}
                        aria-label={`受け取り口「${item.name}」を見る`}
                      >
                        <strong className={styles.otherName}>{item.name}</strong>
                        <span className={styles.otherMeta}>{sourceName(item.sourceType)}</span>
                        <span className={styles.otherMeta}>{maskedEndpoint(endpointUrl(item.id))}</span>
                      </button>
                      <StatusBadge tone={item.isActive ? 'success' : 'neutral'} size="compact">
                        {item.isActive ? '動いています' : '止めています'}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <ListState
            kind="empty"
            title="まだ受け取り口がありません"
            description={canManage
              ? '相手のサービスから知らせを受け取るURLを、「＋ 受け取り口を作る」から作成してください。'
              : '相手のサービスから知らせを受け取るURLは、まだありません。受け取り口の作成は統括に頼んでください。'}
          />
        )}
      </div>
      {dialogs}
    </div>
  )
}
