'use client'

/*
 * ★V8 外部連携「こちらで受け取る」タブ（Pencil `gW0F2`、作る窓 `H031gC`）。
 *
 * 左に受け取り口の列（上に「受け取り口を作る」）、右に選んだ口の設定カード
 * （どこから受け取るか・だれの出来事か・届いたらすること・人が見つからなかった
 * 届物・届いたつもりで試す）。データの口は v7 と同じ（一覧・詳細・未照合の箱・
 * 試し・作成・動かす/止める・合言葉・名前・削除）。
 * 絵と今の作りが合わない所は BEHAVIOR.md に書いた。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Copy, LayoutTemplate, Plus, RefreshCw, Trash2, FlaskConical, Inbox } from 'lucide-react'
import type { IncomingWebhook } from '@line-crm/shared'
import {
  api,
  ApiError,
  type IncomingWebhookDetail as DetailType,
  type IncomingWebhookTestResult,
  type IncomingWebhookUnmatchedItem,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import InlineEdit from '@/components/shared/inline-edit'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import { withViewTransition } from '@/components/shared/view-transition'
import { describeApiFailure } from '@/components/shared/api-error-message'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import {
  MANAGE_REASON,
  ViewerBand,
  WEBHOOKS_DESCRIPTION,
  WebhookBand,
  WebhookTabs,
  overviewBandCells,
  useWebhookOverview,
} from './shell'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import { shortDateTime } from './words'
import styles from './incoming.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
const UNMATCHED_PAGE_SIZE = 50

/* 「どこから来るか」の見本（v7 と同じ値）。見本に無いものは「その他（自分で書く）」。 */
const SOURCE_PRESETS = [
  { value: 'line', label: 'LINE公式アカウント' },
  { value: 'booking', label: '予約サービス' },
  { value: 'form', label: 'アンケートツール' },
  { value: 'ec', label: 'ECサイト' },
  { value: 'payment', label: '決済サービス' },
] as const
const SOURCE_OTHER = '__other__'

function sourceName(value: string): string {
  return SOURCE_PRESETS.find((preset) => preset.value === value)?.label ?? (value || 'その他')
}

function identityMatchingLabel(detail: DetailType | null): string {
  if (!detail || detail.identityMatching.methods.length === 0) return '照合しない'
  return detail.identityMatching.methods.map((method) => ({
    harness_friend_id: 'LINEの友だちIDで探す',
    external_customer_id: '相手の顧客IDで探す',
    verified_email: 'メールアドレスで探す',
    verified_phone: '電話番号で探す',
  }[method.kind] ?? '決めた値で探す')).join('・')
}

function notFoundLabel(value: DetailType['identityMatching']['onNotFound'] | undefined): string {
  switch (value) {
    case 'unmatched_box': return '未照合の箱に入れる'
    case 'create_candidate': return '友だち候補を作る'
    default: return '何もしない'
  }
}

function identityKindLabel(kind: string): string {
  return {
    harness_friend_id: 'LINEの友だちID',
    external_customer_id: '相手の顧客ID',
    verified_email: 'メールアドレス',
    verified_phone: '電話番号',
  }[kind] ?? kind
}

function incomingActionLabel(kind: string): string {
  return {
    tag: 'タグを付ける',
    scenario: 'シナリオを動かす',
    automation: 'オートメーションを動かす',
    conversion: '成果を記録する',
    template: 'テンプレートを送る',
  }[kind] ?? kind
}

function maskedSampleText(fields: NonNullable<DetailType['latestSample']>['fields']): string {
  return fields.map((field) => `  "${field.path}": (${field.type}・値は隠しています)`).join('\n')
}

export default function WebhooksIncomingV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, accounts } = useAccount()
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const staffRole = useStaffRole()
  /* 受け取り口の変更は統括だけ（R32）。届物の結び付けは管理者も使える。 */
  const canManage = staffRole === null || staffRole === 'owner'
  const canResolveUnmatched = staffRole === null || staffRole === 'owner' || staffRole === 'admin'
  const searchParams = useSearchParams()

  const overview = useWebhookOverview()
  const { incoming, incomingStatus, loadedAccountId, reload } = overview

  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailType | null>(null)
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailReloadKey, setDetailReloadKey] = useState(0)

  const [unmatched, setUnmatched] = useState<IncomingWebhookUnmatchedItem[]>([])
  const [unmatchedStatus, setUnmatchedStatus] = useState<LoadStatus>('ready')
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [unmatchedActionError, setUnmatchedActionError] = useState<{ id: string; message: string } | null>(null)
  const [unmatchedTotal, setUnmatchedTotal] = useState<number | null>(null)
  const [unmatchedShown, setUnmatchedShown] = useState(UNMATCHED_PAGE_SIZE)
  const [unmatchedMoreBusy, setUnmatchedMoreBusy] = useState(false)
  const [unmatchedReloadKey, setUnmatchedReloadKey] = useState(0)

  const [testOpen, setTestOpen] = useState(false)
  const [testJson, setTestJson] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<IncomingWebhookTestResult | null>(null)

  const togglingRef = useRef<Set<string>>(new Set())
  const [togglingIds, setTogglingIds] = useState<string[]>([])
  const [optimisticActive, setOptimisticActive] = useState<Record<string, boolean>>({})

  /* 見本タブから `?source=` 付きで来たときは、作る窓を開いて種類を選んでおく（v7 と同じ）。 */
  const requestedSource = searchParams.get('source') ?? ''
  const initialSource = SOURCE_PRESETS.some((preset) => preset.value === requestedSource) ? requestedSource : ''
  const [showCreate, setShowCreate] = useState(initialSource !== '')
  const [createName, setCreateName] = useState('')
  const [createSource, setCreateSource] = useState<string>(initialSource || SOURCE_PRESETS[0].value)
  const [createSourceFree, setCreateSourceFree] = useState('')
  const [createSecret, setCreateSecret] = useState('')
  const [createFieldError, setCreateFieldError] = useState<{ name?: string; secret?: string; form?: string }>({})
  const [creating, setCreating] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string } | null>(null)
  const [rotateSecret, setRotateSecret] = useState('')
  const [rotateError, setRotateError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)

  useEffect(() => {
    if (staffRole !== null && staffRole !== 'owner') setShowCreate(false)
  }, [staffRole])

  const displayed = useMemo(() => incoming.map((item) => (
    optimisticActive[item.id] === undefined ? item : { ...item, isActive: optimisticActive[item.id] }
  )), [incoming, optimisticActive])
  const selected = displayed.find((item) => item.id === selectedId) ?? displayed[0] ?? null
  const selectedDetailId = selected?.id ?? null
  const endpointUrl = (id: string) => `${API_BASE}/api/webhooks/incoming/${id}/receive`

  useEffect(() => {
    if (selectedId && !incoming.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [incoming, selectedId])

  /* ===== 選んだ口の詳細 ===== */
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
      .catch(() => { if (!cancelled) setDetailStatus('error') })
    return () => { cancelled = true }
  }, [detailReloadKey, selectedAccountId, selectedDetailId])

  /* ===== 人が見つからなかった届物 ===== */
  useEffect(() => {
    let cancelled = false
    if (!selectedDetailId || !selectedAccountId || detailStatus !== 'ready') return
    if (unmatched.length === 0) setUnmatchedStatus('loading')
    void api.webhooks.incoming.unmatched(selectedDetailId, selectedAccountId, undefined, { limit: unmatchedShown })
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
      .catch(() => { if (!cancelled) setUnmatchedStatus('error') })
      .finally(() => { if (!cancelled) setUnmatchedMoreBusy(false) })
    return () => { cancelled = true }
  }, [detailStatus, selectedAccountId, selectedDetailId, unmatchedShown, unmatchedReloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setUnmatched([])
    setUnmatchedTotal(null)
    setUnmatchedShown(UNMATCHED_PAGE_SIZE)
    setUnmatchedActionError(null)
    setUnmatchedStatus('ready')
  }, [selectedAccountId, selectedDetailId])

  const selectInlet = (id: string) => withViewTransition(() => setSelectedId(id))
  const moveSelection = (delta: -1 | 1) => {
    if (displayed.length === 0) return
    const current = selected ? displayed.findIndex((item) => item.id === selected.id) : -1
    const next = current === -1
      ? (delta === 1 ? 0 : displayed.length - 1)
      : Math.min(displayed.length - 1, Math.max(0, current + delta))
    const target = displayed[next]
    if (target && target.id !== selected?.id) selectInlet(target.id)
  }

  /* 名前のその場の書き換え。失敗したら投げて元に戻す（共通部品の約束）。 */
  const renameInlet = async (next: string) => {
    const accountId = selectedAccountId
    const target = selected
    if (!accountId || !target) throw new Error('no target')
    const trimmed = next.trim()
    if (!trimmed) throw new Error('empty name')
    const res = await api.webhooks.incoming.update(target.id, accountId, { name: trimmed })
    if (accountRef.current !== accountId) throw new Error('stale account')
    if (!res.success) throw new Error(res.error)
    await reload()
  }

  /* ===== 動かす・止める（押した瞬間に変え、裏で保存する） ===== */
  const handleToggle = async (item: IncomingWebhook, currentActive: boolean) => {
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) {
      setError('LINEアカウントの一覧を読み直してください')
      return
    }
    if (togglingRef.current.has(item.id)) {
      notifyToast(`「${item.name}」：いま切り替えを送っています。返事が来るまでお待ちください。`)
      return
    }
    togglingRef.current.add(item.id)
    setTogglingIds((current) => [...current, item.id])
    setOptimisticActive((current) => ({ ...current, [item.id]: !currentActive }))
    const clear = () => setOptimisticActive((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    const fail = (message: string) => {
      clear()
      notifyToast(message, { tone: 'error', actionLabel: 'もう一度', onAction: () => { void handleToggle(item, currentActive) } })
    }
    try {
      const res = await api.webhooks.incoming.update(item.id, accountId, { isActive: !currentActive })
      if (accountRef.current !== accountId) return
      if (!res.success) {
        fail(`「${item.name}」は切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。`)
        return
      }
      await reload()
      clear()
      notifyToast(`「${item.name}」を${!currentActive ? '動かしました' : '止めました'}。`, {
        actionLabel: '元に戻す',
        onAction: () => { void handleToggle(item, !currentActive) },
      })
    } catch (caught) {
      if (accountRef.current !== accountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      fail(forbidden
        ? `「${item.name}」は統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。`
        : `「${item.name}」は切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。`)
    } finally {
      togglingRef.current.delete(item.id)
      setTogglingIds((current) => current.filter((id) => id !== item.id))
    }
  }

  /* ===== 削除 ===== */
  const runDelete = async () => {
    if (!deleteTarget || deleting) return
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) {
      setDeleteError('LINEアカウントが切り替わりました。削除する受け取り口を選び直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.incoming.delete(deleteTarget.id, accountId)
      if (!res.success) throw new Error(res.error)
      if (accountRef.current !== accountId) return
      setDeleteTarget(null)
      await reload()
    } catch (caught) {
      if (accountRef.current !== accountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      setDeleteError(forbidden
        ? 'この受け取り口の削除は統括だけができます。必要なときは統括に頼んでください。'
        : 'この受け取り口を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* ===== 合言葉を更新する ===== */
  const runRotate = async (stepUpToken?: string) => {
    setRotateError('')
    const accountId = selectedAccountId
    if (!rotateTarget) return
    if (!accountId || loadedAccountId !== accountId) {
      setRotateError('LINEアカウントの一覧を読み直してください')
      return
    }
    if (rotateSecret.length < MIN_SECRET_LENGTH) {
      setRotateError(`合言葉は${MIN_SECRET_LENGTH}文字以上にしてください`)
      return
    }
    try {
      const res = await api.webhooks.incoming.update(rotateTarget.id, accountId, { secret: rotateSecret }, stepUpToken)
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setRotateError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecret('')
      void reload()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: 'シークレットを更新する', retry: (token) => runRotate(token) })
        return
      }
      if (accountRef.current !== accountId) return
      setRotateError(describeApiFailure(caught, 'シークレットの更新', {
        forbidden: '合言葉の更新は統括だけができます。必要なときは統括に頼んでください。',
      }))
    }
  }

  /* ===== 受け取り口を作る（窓 H031gC） ===== */
  const openCreate = () => {
    setCreateFieldError({})
    if (!createSecret) setCreateSecret(generateSecret())
    setShowCreate(true)
  }
  const runCreate = async (stepUpToken?: string) => {
    setCreateFieldError({})
    const accountId = selectedAccountId
    if (!accountId) {
      setCreateFieldError({ form: 'LINEアカウントを選択してください' })
      return
    }
    const sourceValue = createSource === SOURCE_OTHER ? createSourceFree.trim() : createSource
    if (!createName.trim()) {
      setCreateFieldError({ name: '名前を入力してください' })
      return
    }
    if (createSecret.length < MIN_SECRET_LENGTH) {
      setCreateFieldError({ secret: `シークレットは${MIN_SECRET_LENGTH}文字以上にしてください` })
      return
    }
    setCreating(true)
    try {
      const res = await api.webhooks.incoming.create({
        lineAccountId: accountId,
        name: createName.trim(),
        sourceType: sourceValue || undefined,
        secret: createSecret,
      }, stepUpToken)
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setCreateFieldError({ form: res.error })
        return
      }
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setCreateName('')
      setCreateSource(SOURCE_PRESETS[0].value)
      setCreateSourceFree('')
      setCreateSecret('')
      setShowCreate(false)
      await reload()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '受け取り口を登録する', retry: (token) => runCreate(token) })
        return
      }
      if (accountRef.current !== accountId) return
      setCreateFieldError({
        form: describeApiFailure(caught, '作成', {
          forbidden: '受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。',
        }),
      })
    } finally {
      if (accountRef.current === accountId) setCreating(false)
    }
  }

  /* ===== 届物を結び付ける・確認した ===== */
  const reloadUnmatchedBox = () => {
    setUnmatchedReloadKey((key) => key + 1)
    setDetailReloadKey((key) => key + 1)
  }
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
        setUnmatchedActionError({ id: item.id, message: res.error || '保存できませんでした。一覧を読み直してから、もう一度お試しください。' })
        return
      }
      reloadUnmatchedBox()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        reloadUnmatchedBox()
        setUnmatchedActionError({ id: item.id, message: 'すでに処理済みです。最新の状態を読み直しました。' })
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

  /* ===== 届いたつもりで試す ===== */
  const runTest = async () => {
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
      setTestError(describeApiFailure(caught, '試し', { forbidden: 'この操作を行う権限がありません。統括に頼んでください。' }))
      setTestResult(null)
    } finally {
      setTestBusy(false)
    }
  }

  const sampleText = detail?.latestSample
    ? `{\n${maskedSampleText(detail.latestSample.fields)}\n}`
    : '{ "email": "kenta@example.com",\n"フォーム": "体験申込" }'

  /* ===== 左の列 ===== */
  const leftColumn = (
    <div
      className={styles.inletCol}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        const target = event.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        event.preventDefault()
        moveSelection(event.key === 'ArrowUp' ? -1 : 1)
      }}
    >
      {/* 閲覧のみには押せない作るボタンを置かない（場所だけ空ける）。 */}
      {canManage
        ? <Button variant="primary" className={styles.createButton} onClick={openCreate}><Plus size={15} aria-hidden="true" />受け取り口を作る</Button>
        : <span className={styles.createSpace} aria-hidden="true" />}
      <p className={styles.inletListLabel}>受け取り口</p>
      {incomingStatus === 'loading' && selectedAccountId ? (
        <div aria-busy="true" aria-label="受け取り口を読み込んでいます">
          <DelayedSkeleton
            loading
            skeleton={(
              <div aria-hidden="true">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={styles.inletItem}>
                    <Skeleton className={styles.skeletonName} />
                    <Skeleton className={styles.skeletonSub} />
                  </div>
                ))}
              </div>
            )}
          />
        </div>
      ) : null}
      {incomingStatus === 'error' ? (
        <ListState kind="error" title="受け取り口を読み込めませんでした" action={<Button onClick={() => void reload()}>もう一度読み込む</Button>} />
      ) : null}
      {displayed.map((item) => {
        const isSelected = selected?.id === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => selectInlet(item.id)}
            className={styles.inletItem}
            data-selected={isSelected || undefined}
            aria-current={isSelected || undefined}
            aria-label={`受け取り口「${item.name}」を見る`}
          >
            <span className={styles.inletRow}>
              <span className={styles.inletName}>{item.name}</span>
              <span className={styles.spacer} aria-hidden="true" />
              <span className={styles.inletState}>{item.isActive ? '動いている' : '止めている'}</span>
            </span>
            <span className={styles.inletSub}>{sourceName(item.sourceType)}から</span>
          </button>
        )
      })}
    </div>
  )

  /* ===== 右の設定 ===== */
  let rightColumn
  if (!selectedAccountId) {
    rightColumn = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (incomingStatus === 'ready' && !selected) {
    /* 修正案 D-2：空の一覧。 */
    rightColumn = (
      <EmptyList
        icon={<Inbox aria-hidden="true" />}
        title="まだ受け取り口がありません"
        description="相手のサービスから届く知らせを受け取る URL を作ります。"
        create={{ label: '最初の受け取り口を作る', onClick: openCreate }}
        canCreate={canManage}
      />
    )
  } else if (!selected) {
    rightColumn = null
  } else {
    const toggling = togglingIds.includes(selected.id)
    rightColumn = (
      <>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>
            {/* 閲覧のみ：名前を変える鉛筆は置かず、名前だけ見せる（2026-10-06 オーナー決定） */}
            {canManage
              ? <InlineEdit value={selected.name} label="受け取り口の名前" onSave={renameInlet} />
              : selected.name}
          </h2>
          <span className={styles.pill} data-tone={toggling ? 'neutral' : selected.isActive ? 'active' : 'neutral'}>
            <span className={styles.pillDot} aria-hidden="true" />
            {toggling ? '切り替え中' : selected.isActive ? '動いています' : '止めています'}
          </span>
          <span className={styles.spacer} aria-hidden="true" />
          {canManage ? (
            <>
              <span className={styles.toggleLabel}>動かす</span>
              <Toggle checked={selected.isActive} label={`${selected.name}を動かす`} onChange={() => void handleToggle(selected, selected.isActive)} />
            </>
          ) : null}
        </div>

        <section className={styles.card} aria-labelledby="wh-in-receive">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle} id="wh-in-receive">どこから受け取るか</h3>
            <p className={styles.cardNote}>相手のサービスで「Webhook（ウェブフック）」の送り先にこの URL を貼ります</p>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>受け取る URL（相手のサービスに貼る）</span>
              <span className={styles.valueBox} title={endpointUrl(selected.id)}>{endpointUrl(selected.id)}</span>
            </div>
            <Button onClick={() => { void navigator.clipboard.writeText(endpointUrl(selected.id)); notifyToast('受け取る URL を写しました') }}>
              <Copy size={15} aria-hidden="true" />写す
            </Button>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>合言葉（署名）</span>
              <span className={styles.valueBox}>{selected.hasSecret ? '設定済み（再表示しません）' : 'まだ設定していません'}</span>
            </div>
            {canManage ? (
              <Button onClick={() => { setRotateError(''); setRotateSecret(''); setRotateTarget({ id: selected.id, name: selected.name }) }}>
                <RefreshCw size={15} aria-hidden="true" />合言葉を更新する
              </Button>
            ) : null}
          </div>
          <p className={styles.smallNote}>合言葉は人に見せないでください。知られると、第三者がデータを送れるようになります。</p>
          {selected.previousSecretUsableUntil ? (
            <p className={styles.smallNote}>前の合言葉は {shortDateTime(selected.previousSecretUsableUntil)} まで使えます。</p>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="wh-in-identity">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle} id="wh-in-identity">だれの出来事か（人の見分けかた）</h3>
            <p className={styles.cardNote}>人が見つからないと何も起きません</p>
          </div>
          <div className={styles.pickGrid}>
            <div className={styles.field}>
              <span className={styles.pickLabel}>見分けに使う値</span>
              <span className={styles.pickBox}>
                {detailStatus === 'loading' ? '読み込んでいます' : detailStatus === 'error' ? '確認できませんでした' : identityMatchingLabel(detail)}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.pickLabel}>見つからないとき</span>
              <span className={styles.pickBox}>
                {detailStatus === 'loading' ? '読み込んでいます' : detailStatus === 'error' ? '確認できませんでした' : notFoundLabel(detail?.identityMatching.onNotFound)}
              </span>
            </div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="wh-in-actions">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle} id="wh-in-actions">届いたらすること</h3>
            <p className={styles.cardNote}>上から順に動きます</p>
          </div>
          {detailStatus === 'loading' ? (
            <p className={styles.cardNote}>保存されている処理を読み込んでいます。</p>
          ) : detailStatus === 'error' ? (
            <ListState kind="error" title="届いた後の処理を表示できませんでした" action={<Button onClick={() => setDetailReloadKey((key) => key + 1)}>詳細を読み直す</Button>} />
          ) : detail && detail.actions.length > 0 ? (
            detail.actions.map((action, index) => (
              <div key={`${action.refKind}-${index}`} className={styles.actionRow}>
                <span className={styles.actionName}>{`${index + 1} ${incomingActionLabel(action.refKind)}`}</span>
                <span className={styles.spacer} aria-hidden="true" />
                <span className={styles.actionTarget}>{`「${action.displayName}」`}</span>
              </div>
            ))
          ) : (
            <p className={styles.cardNote}>届いた後に動かす処理は、まだ決めていません。</p>
          )}
          {/* 絵の「＋ すること を足す」。設定の口（PATCH …/config）はあるが画面の配線がまだ無いので、押せる形にせず一言で伝える。 */}
          {detailStatus === 'ready' ? <p className={styles.addNote}>すること の追加・入れ替えは、この画面ではまだできません</p> : null}
          {detail?.actionExecution.state === 'needs_attention' && detail.actionExecution.reason ? (
            <p className={styles.smallNote}>{detail.actionExecution.reason}</p>
          ) : null}
        </section>

        {detail && (detail.identityMatching.onNotFound !== 'do_nothing' || unmatched.length > 0 || (detail.pendingUnmatched ?? 0) > 0 || unmatchedStatus === 'error') ? (
          <section className={styles.card} aria-labelledby="wh-in-unmatched">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle} id="wh-in-unmatched">人が見つからなかった届物</h3>
              <p className={styles.cardNote}>
                {(detail.pendingUnmatched ?? 0) > 0 ? `${detail.pendingUnmatched} 件。` : ''}結び付けると、届いたらすることが動きます
              </p>
            </div>
            {unmatchedStatus === 'loading' ? (
              <p className={styles.cardNote}>届物を読み込んでいます。</p>
            ) : unmatchedStatus === 'error' ? (
              <div>
                <p className={styles.cardNote}>届物を表示できませんでした。確認待ちの届物は消えていません。</p>
                <Button onClick={() => setUnmatchedReloadKey((key) => key + 1)}>届物だけ読み直す</Button>
              </div>
            ) : (unmatchedTotal ?? detail.pendingUnmatched ?? unmatched.length) === 0 ? (
              <p className={styles.cardNote}>いま確認が必要な届物はありません。</p>
            ) : (
              <>
                <div className={styles.miniHead} role="presentation">
                  <span className={styles.miniWhen}>届いた日時</span>
                  <span className={styles.miniValue}>届いた値</span>
                  <span className={styles.miniCandidate}>候補</span>
                  <span className={styles.miniOps} />
                </div>
                {unmatched.map((item) => (
                  <div key={item.id} className={styles.miniRow}>
                    <span className={styles.miniWhen}>{shortDateTime(item.receivedAt)}</span>
                    <span className={styles.miniValue} title={item.identityAttempts.map((attempt: { kind: string; value: string }) => `${identityKindLabel(attempt.kind)}：${attempt.value}`).join('、')}>
                      {item.identityAttempts.length > 0
                        ? item.identityAttempts.map((attempt: { kind: string; value: string }) => attempt.value).join('、')
                        : '照合に使える値が届いていません'}
                    </span>
                    <span className={styles.miniCandidate}>
                      {item.kind === 'candidate'
                        ? '1人の友だちに一致'
                        : item.kind === 'ambiguous'
                          ? item.candidates.length > 0 ? `${item.candidates.length}人の友だちに一致` : '2人以上に一致'
                          : '一致する友だちがいません'}
                    </span>
                    <span className={styles.miniOps}>
                      {canResolveUnmatched ? (
                        item.kind === 'candidate' && item.candidates[0] ? (
                          <Button disabled={dismissingId !== null} busy={dismissingId === item.id} onClick={() => void resolveUnmatched(item, { action: 'link', friendId: item.candidates[0].friendId })}>結び付ける</Button>
                        ) : (
                          <Button disabled={dismissingId !== null} busy={dismissingId === item.id} onClick={() => void resolveUnmatched(item, { action: 'dismiss' })}>
                            {item.kind === 'ambiguous' ? 'どれでもない' : '確認した'}
                          </Button>
                        )
                      ) : null}
                    </span>
                    {unmatchedActionError && unmatchedActionError.id === item.id ? (
                      <p role="alert" className={styles.fieldError}>{unmatchedActionError.message}</p>
                    ) : null}
                  </div>
                ))}
                {(unmatchedTotal ?? detail.pendingUnmatched ?? 0) > unmatched.length ? (
                  <div className={styles.moreRow}>
                    <span className={styles.cardNote}>ほか{(unmatchedTotal ?? detail.pendingUnmatched ?? 0) - unmatched.length}件あります。</span>
                    <Button disabled={unmatchedMoreBusy} busy={unmatchedMoreBusy} onClick={() => { setUnmatchedMoreBusy(true); setUnmatchedShown((shown) => shown + UNMATCHED_PAGE_SIZE) }}>さらに表示</Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="wh-in-try">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle} id="wh-in-try">届いたつもりで試す</h3>
            <p className={styles.cardNote}>見本の JSON で、どの人に届くかと何が動くかを確かめます。実際の処理は動きません</p>
          </div>
          <pre className={styles.sampleBox}>{sampleText}</pre>
          <div>
            <Button
              onClick={() => {
                setTestJson(detail?.latestSample ? '{\n  "friendId": "ここに届くデータの形を入れてください"\n}' : '{ "email": "kenta@example.com", "フォーム": "体験申込" }')
                setTestResult(null)
                setTestError('')
                setTestOpen(true)
              }}
            >
              <FlaskConical size={15} aria-hidden="true" />試す
            </Button>
          </div>
        </section>
        {/* 削除は絵に無い。消さずに、カードの下へ小さく置く（押すと確かめの窓）。 */}
        {canManage ? (
          <div className={styles.dangerRow}>
            <Button variant="text" onClick={() => { setDeleteError(''); setDeleteTarget({ id: selected.id, name: selected.name }) }}>
              <Trash2 size={15} aria-hidden="true" />この受け取り口を削除する
            </Button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <ListPage
      boardId="gW0F2"
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      actions={canManage ? <Button href="/webhooks?tab=notify"><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button> : undefined}
      tabs={<WebhookTabs active="incoming" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!canManage ? <ViewerBand /> : null}
        <WebhookBand
          cells={overviewBandCells({
            outgoing: overview.outgoingCount === null ? null : overview.outgoing,
            incomingCount: overview.incomingCount,
            summary: overview.summary,
          })}
        />
      </>}
      overlays={<>
        <Dialog
          open={showCreate && canManage}
          title="受け取る設定を追加"
          designNode="H031gC"
          designWidth={540}
          designTop={200}
          busy={creating}
          error={createFieldError.form}
          onCancel={() => { if (!creating) setShowCreate(false) }}
          onConfirm={() => void runCreate()}
          confirmLabel="作る"
          confirmIcon={<Plus size={15} aria-hidden="true" />}
        >
          <div className={`${styles.form} ${styles.formTight}`}>
            <label className={styles.formField}>
              <span className={styles.fieldLabel}>名前</span>
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="体験申込フォーム（自社サイト）"
                className={styles.input}
                aria-invalid={Boolean(createFieldError.name) || undefined}
              />
              {createFieldError.name ? <span className={styles.fieldError} role="alert">{createFieldError.name}</span> : null}
            </label>
            <div className={styles.formField}>
              <span className={styles.pickLabel}>どこから来るか</span>
              <Select
                aria-label="どこから来るか"
                size="full"
                value={createSource}
                onChange={(value) => setCreateSource(value)}
                options={[
                  ...SOURCE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
                  { value: SOURCE_OTHER, label: 'その他（自分で書く）' },
                ]}
              />
              {createSource === SOURCE_OTHER ? (
                <input
                  value={createSourceFree}
                  onChange={(event) => setCreateSourceFree(event.target.value)}
                  placeholder="見本に無いものを自由に書けます"
                  className={styles.input}
                  aria-label="どこから来るか（自由入力）"
                />
              ) : null}
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>シークレット</span>
                <input
                  value={createSecret}
                  onChange={(event) => setCreateSecret(event.target.value)}
                  placeholder="相手と決めた合言葉（32文字以上）"
                  className={`${styles.input} ${styles.mono}`}
                  aria-invalid={Boolean(createFieldError.secret) || undefined}
                />
              </label>
              <Button type="button" onClick={() => setCreateSecret(generateSecret())}><RefreshCw size={15} aria-hidden="true" />自動生成</Button>
            </div>
            {createFieldError.secret ? <span className={styles.fieldError} role="alert">{createFieldError.secret}</span> : null}
            <p className={styles.noteBox}>作るときに本人確認が出ます。</p>
          </div>
        </Dialog>

        <Dialog
          open={testOpen}
          title="届いたつもりで試す"
          description="見本のJSONで、どの人に届くかと何が動くかを確かめます。実際の処理は動きません。"
          onCancel={() => setTestOpen(false)}
          onConfirm={() => { if (testJson.trim()) void runTest() }}
          busy={testBusy}
          confirmLabel="試す"
        >
          <label className={styles.formField}>
            <span className={styles.fieldLabel}>届いたつもりのJSON</span>
            <textarea className={`${styles.input} ${styles.textarea}`} value={testJson} onChange={(event) => setTestJson(event.target.value)} placeholder='{"friendId": "…"}' />
          </label>
          {testError ? <p className={styles.fieldError} role="alert">{testError}</p> : null}
          {testResult ? (
            <div className={styles.form}>
              <span className={styles.fieldLabel}>だれに届くか</span>
              <p className={styles.cardNote}>
                {testResult.match.status === 'matched'
                  ? '1人の友だちに一致しました'
                  : testResult.match.status === 'ambiguous'
                    ? `同じ値の友だちが${testResult.match.friendIds.length}人います。実際に届くと保留になり、人が選びます。`
                    : '一致する友だちがいません'}
              </p>
              <span className={styles.fieldLabel}>動く予定の処理</span>
              {testResult.actions.length > 0 ? testResult.actions.map((action: IncomingWebhookTestResult['actions'][number]) => (
                <div key={action.refIndex} className={styles.actionRow}>
                  <span className={styles.actionName}>{incomingActionLabel(action.refKind)}：{action.displayName}</span>
                  <span className={styles.spacer} aria-hidden="true" />
                  <span className={styles.actionTarget}>{action.ok ? `(${action.plan?.length ?? 0}件の処理)` : action.error}</span>
                </div>
              )) : <p className={styles.cardNote}>動く処理はまだ決めていません</p>}
            </div>
          ) : null}
        </Dialog>

        <ConfirmDialog
          open={deleteTarget !== null}
          title={`「${deleteTarget?.name ?? ''}」の受け取り口を削除しますか？`}
          description="このURLへの通知を受け取らなくなります。すでに受け取った記録は残ります。この操作は取り消せません。"
          confirmLabel="削除する"
          destructive
          busy={deleting}
          error={deleteError || undefined}
          onConfirm={() => void runDelete()}
          onCancel={() => { if (!deleting) { setDeleteTarget(null); setDeleteError('') } }}
        />

        <Dialog
          open={rotateTarget !== null}
          title={rotateTarget ? `「${rotateTarget.name}」の合言葉を更新する` : ''}
          description="新しい合言葉を設定します。保存したあとは二度と全部は表示されません。前の合言葉は24時間だけ使えるので、相手側の切り替え中も受け取りは止まりません。"
          error={rotateError || undefined}
          onCancel={() => { setRotateTarget(null); setRotateSecret('') }}
          onConfirm={() => void runRotate()}
          confirmLabel="保存する"
        >
          <div className={styles.fieldRow}>
            <input
              value={rotateSecret}
              onChange={(event) => setRotateSecret(event.target.value)}
              className={`${styles.input} ${styles.mono}`}
              placeholder="ランダムな英数字32文字以上"
              aria-label="新しい合言葉"
              autoFocus
            />
            <Button type="button" onClick={() => setRotateSecret(generateSecret())}>自動生成</Button>
          </div>
        </Dialog>

        {createdSecret ? (
          <Dialog
            open
            title="受け取り口を作りました"
            description="合言葉はこの画面で1回だけ表示します。相手のサービスに書き写してから閉じてください。"
            onCancel={() => setCreatedSecret(null)}
          >
            <span className={styles.fieldLabel}>名前</span>
            <p className={styles.cardNote}>{createdSecret.name}</p>
            <span className={styles.fieldLabel}>合言葉（今回だけ表示）</span>
            <div className={styles.fieldRow}>
              <p className={`${styles.valueBox} ${styles.mono} ${styles.grow}`}>{createdSecret.secret}</p>
              <Button onClick={() => { void navigator.clipboard.writeText(createdSecret.secret); notifyToast('合言葉を写しました') }}><Copy size={15} aria-hidden="true" />写す</Button>
            </div>
          </Dialog>
        ) : null}
        {stepUp ? <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} /> : null}
      </>}
    >
      {error ? <div className={styles.errorRow}><Notice tone="danger" message={error} onClose={() => setError('')} /></div> : null}
      {!canManage ? <p className={styles.srOnly}>{MANAGE_REASON}</p> : null}
      <div className={styles.body}>
        {leftColumn}
        <div className={styles.main}>{rightColumn}</div>
      </div>
    </ListPage>
  )
}
