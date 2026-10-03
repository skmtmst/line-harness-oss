'use client'

/*
 * ★V8-B 外部連携のこちらで受け取る（板 `gW0F2`）。
 *
 * v7 の受け取るタブ（`page.tsx` の WebhooksPageInner＋`webhook-overviews.tsx` の
 * IncomingOverview）とは別の部品として持つ。データの口（一覧・詳細・未照合の
 * 箱・試し・作成・開始と停止・合言葉・削除）は同じ。違いは置き場と見せ方——
 * 左に受け取り口の列、右に設定カードを並べる。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 受け取り口ごとの今月件数：口ごとの月次集計が無いので、動いているか
 *   止めているかだけ出す。
 * - 見分けに使う値・見つからないとき：今の画面に変える口が無いので、
 *   いまの設定を文字で出す（選ぶ欄にはしない）。
 * - 届いたらすることの「することを足す」：足す口が無いので出さない。
 * - 届いたつもりで試すの見本：最後に届いた見本が無いときは空のまま。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { api, ApiError, type IncomingWebhookDetail as DetailType, type IncomingWebhookTestResult, type IncomingWebhookUnmatchedItem, type OutgoingWebhookOverview } from '@/lib/api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatDateTime } from '@/lib/format'
import { isStepUpRequired } from '@/components/step-up-prompt'
import StepUpPrompt, { type StepUpRequest } from '@/components/step-up-prompt'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import {
  WebhooksV8Band, WebhooksV8Head, outgoingKpiCells,
} from './outgoing-v8'
import styles from './incoming-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
const UNMATCHED_PAGE_SIZE = 50

const SOURCE_PRESETS = [
  { value: 'line', label: 'LINE公式アカウント' },
  { value: 'booking', label: '予約サービス' },
  { value: 'form', label: 'アンケートツール' },
  { value: 'ec', label: 'ECサイト' },
  { value: 'payment', label: '決済サービス' },
] as const

const SOURCE_OTHER = '__other__'

function sourceName(value: string): string {
  return SOURCE_PRESETS.find((preset) => preset.value === value)?.label ?? 'その他'
}

function maskedEndpoint(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}/in/•••`
  } catch {
    return 'URLを確かめてください'
  }
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

function formatReceivedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}

function maskedSampleText(fields: NonNullable<DetailType['latestSample']>['fields']): string {
  return fields.map((field) => `  "${field.path}": (${field.type}・値は隠しています)`).join('\n')
}

export default function IncomingV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <IncomingV8Inner />
    </Suspense>
  )
}

function IncomingV8Inner() {
  usePageTitle('外部連携')
  const { selectedAccountId, accounts } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const togglingIdsRef = useRef<Set<string>>(new Set())

  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [incomingStatus, setIncomingStatus] = useState<LoadStatus>('loading')
  const [outgoingItems, setOutgoingItems] = useState<OutgoingWebhookOverview[] | null>(null)
  const [bandSummary, setBandSummary] = useState<WebhookInteractionSummary | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [staffRole, setStaffRole] = useState<string | null>(null)

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

  const [togglingKeys, setTogglingKeys] = useState<string[]>([])
  const [toggleFailures, setToggleFailures] = useState<Record<string, string>>({})
  const [toggleBusyNotices, setToggleBusyNotices] = useState<Record<string, string>>({})

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSource, setCreateSource] = useState<string>('line')
  const [createSourceFree, setCreateSourceFree] = useState('')
  const [createSecret, setCreateSecret] = useState('')
  const [createFieldError, setCreateFieldError] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string; activate: boolean } | null>(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const rotateModalRef = useOverlayFocus(!!rotateTarget, () => {
    setRotateTarget(null)
    setRotateSecretValue('')
  })

  const canManage = staffRole === null || staffRole === 'owner'
  const canResolveUnmatched = staffRole === null || staffRole === 'owner' || staffRole === 'admin'
  const manageReason = '統括だけが変更できます。必要なときは統括に頼んでください。'

  // B. 押した瞬間に札とスイッチを変えて裏で保存する。
  const [optimisticActive, setOptimisticActive] = useState<Record<string, boolean>>({})
  const displayed = useMemo(() => (
    incoming.map((item) => (
      optimisticActive[item.id] === undefined ? item : { ...item, isActive: optimisticActive[item.id] }
    ))
  ), [incoming, optimisticActive])
  const selected = displayed.find((item) => item.id === selectedId) ?? displayed[0] ?? null
  const selectedDetailId = selected?.id ?? null
  const endpointUrl = (id: string) => `${API_BASE}/api/webhooks/incoming/${id}/receive`

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setIncoming([])
    setOutgoingItems(null)
    setBandSummary(null)
    setLoadedAccountId(null)
    setError('')
    if (!requestAccountId) {
      setIncomingStatus('ready')
      return
    }
    setIncomingStatus('loading')
    const [incomingResult, outgoingResult, interactionsResult] = await Promise.allSettled([
      api.webhooks.incoming.list(requestAccountId),
      api.webhooks.outgoing.list(requestAccountId),
      api.webhooks.interactions.list(requestAccountId, { periodDays: 30, page: 1, limit: 1 }),
    ])
    if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
    if (incomingResult.status === 'fulfilled' && incomingResult.value.success) {
      setIncoming(incomingResult.value.data)
      setIncomingStatus('ready')
    } else {
      setIncoming([])
      setIncomingStatus('error')
    }
    if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
      setOutgoingItems(outgoingResult.value.data)
    }
    if (interactionsResult.status === 'fulfilled' && interactionsResult.value.success && interactionsResult.value.data?.summary) {
      setBandSummary(interactionsResult.value.data.summary)
    }
    setLoadedAccountId(requestAccountId)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (staffRole !== null && staffRole !== 'owner') setShowCreate(false)
  }, [staffRole])

  useEffect(() => {
    if (selectedId && !incoming.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [incoming, selectedId])

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

  useEffect(() => {
    let cancelled = false
    if (!selectedDetailId || !selectedAccountId || detailStatus !== 'ready') return
    const webhookId = selectedDetailId
    const accountId = selectedAccountId
    if (unmatched.length === 0) setUnmatchedStatus('loading')
    void api.webhooks.incoming.unmatched(webhookId, accountId, undefined, { limit: unmatchedShown })
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
  }, [detailStatus, selectedAccountId, selectedDetailId, unmatchedShown, unmatchedReloadKey])

  useEffect(() => {
    setUnmatched([])
    setUnmatchedTotal(null)
    setUnmatchedShown(UNMATCHED_PAGE_SIZE)
    setUnmatchedActionError(null)
    setUnmatchedStatus('ready')
  }, [selectedAccountId, selectedDetailId])

  const beginToggle = (key: string) => {
    togglingIdsRef.current.add(key)
    setTogglingKeys((current) => (current.includes(key) ? current : [...current, key]))
    setToggleFailures((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const endToggle = (key: string) => {
    togglingIdsRef.current.delete(key)
    setTogglingKeys((current) => current.filter((item) => item !== key))
    setToggleBusyNotices((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    const key = `incoming:${id}`
    if (togglingIdsRef.current.has(key)) {
      const name = incoming.find((item) => item.id === id)?.name ?? 'この受け取り口'
      setToggleBusyNotices((current) => ({ ...current, [key]: name }))
      return
    }
    beginToggle(key)
    // 先に札とスイッチを変える。裏の保存が終わるまでこの値を出し続ける。
    const name = incoming.find((item) => item.id === id)?.name ?? 'この受け取り口'
    setOptimisticActive((current) => ({ ...current, [id]: !currentActive }))
    const clearOptimistic = () => {
      setOptimisticActive((current) => {
        if (current[id] === undefined) return current
        const next = { ...current }
        delete next[id]
        return next
      })
    }
    const failMessage = (reason: string) => {
      clearOptimistic()
      setToggleFailures((current) => ({ ...current, [key]: reason }))
      notifyToast(reason, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void handleToggle(id, currentActive) },
      })
    }
    try {
      const res = await api.webhooks.incoming.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        failMessage(`「${name}」は切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。`)
        return
      }
      if (selectedAccountIdRef.current === requestAccountId) await load()
      clearOptimistic()
      notifyToast(`「${name}」を${!currentActive ? '動かしました' : '止めました'}。`, {
        actionLabel: '元に戻す',
        onAction: () => { void handleToggle(id, !currentActive) },
      })
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      failMessage(forbidden
        ? `「${name}」は統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。`
        : `「${name}」は切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。`)
    } finally {
      endToggle(key)
    }
  }

  const askDelete = (item: IncomingWebhook) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    setDeleteError('')
    setDeleteTarget({ id: item.id, name: item.name })
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      setDeleteError('LINEアカウントが切り替わりました。削除する受け取り口を選び直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.incoming.delete(deleteTarget.id, requestAccountId)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== requestAccountId) return
      setDeleteTarget(null)
      await load()
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      setDeleteError(forbidden
        ? 'この受け取り口の削除は統括だけができます。必要なときは統括に頼んでください。'
        : 'この受け取り口を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const handleRotateSubmit = async (e: React.FormEvent, stepUpToken?: string) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    if (!rotateTarget) return
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const res = await api.webhooks.incoming.update(
        rotateTarget.id, requestAccountId,
        { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined },
        stepUpToken,
      )
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      void load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: 'シークレットを更新する', retry: (token) => handleRotateSubmit(e, token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError(describeApiFailure(caught, 'シークレットの更新', {
        forbidden: '合言葉の更新は統括だけができます。必要なときは統括に頼んでください。',
      }))
    }
  }

  const handleCreateIncoming = async (e: React.FormEvent, stepUpToken?: string) => {
    e.preventDefault()
    setError('')
    setCreateFieldError({})
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return setError('LINEアカウントを選択してください')
    const sourceValue = createSource === SOURCE_OTHER ? createSourceFree.trim() : createSource
    if (!createName.trim()) {
      setCreateFieldError({ name: '名前を入力してください' })
      return
    }
    if (createSecret.length < MIN_SECRET_LENGTH) {
      setCreateFieldError({ secret: `シークレットは最低${MIN_SECRET_LENGTH}文字必要です` })
      return
    }
    setCreating(true)
    try {
      const res = await api.webhooks.incoming.create({
        lineAccountId: requestAccountId,
        name: createName.trim(),
        sourceType: sourceValue || undefined,
        secret: createSecret,
      }, stepUpToken)
      if (!res.success) {
        if (selectedAccountIdRef.current !== requestAccountId) return
        setError(res.error)
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setCreateName('')
      setCreateSource('line')
      setCreateSourceFree('')
      setCreateSecret('')
      setShowCreate(false)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '受け取り口を登録する', retry: (token) => handleCreateIncoming(e, token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError(describeApiFailure(caught, '作成', {
        forbidden: '受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setCreating(false)
    }
  }

  const reloadUnmatchedBox = () => {
    setUnmatchedReloadKey((key) => key + 1)
    setDetailReloadKey((key) => key + 1)
  }

  const resolveUnmatched = async (
    item: IncomingWebhookUnmatchedItem,
    payload: { action: 'dismiss' } | { action: 'link'; friendId: string },
  ) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || dismissingId !== null) return
    setDismissingId(item.id)
    setUnmatchedActionError(null)
    try {
      const res = await api.webhooks.incoming.resolveUnmatched(item.id, requestAccountId, payload)
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
    const requestAccountId = selectedAccountId
    if (!requestAccountId || !selectedDetailId || testBusy) return
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
      const res = await api.webhooks.incoming.test(selectedDetailId, requestAccountId, payload)
      if (!res.success) {
        setTestError(res.error)
        setTestResult(null)
        return
      }
      setTestResult(res.data)
    } catch (caught) {
      setTestError(describeApiFailure(caught, '試し', {
        forbidden: 'この操作を行う権限がありません。統括に頼んでください。',
      }))
      setTestResult(null)
    } finally {
      setTestBusy(false)
    }
  }

  const readyCounts = incomingStatus === 'ready'
  const bandCells = outgoingKpiCells({
    items: outgoingItems,
    incomingCount: readyCounts ? incoming.length : null,
    summary: bandSummary,
  })

  const toggling = (id: string) => togglingKeys.includes(`incoming:${id}`)

  return (
    <div className={styles.board} data-design-node="gW0F2">
      <WebhooksV8Head activeTab="incoming" outgoingCount={outgoingItems === null ? null : outgoingItems.length} incomingCount={readyCounts ? incoming.length : null} />
      <WebhooksV8Band cells={bandCells} />

      <Notice tone="info">
        相手のサービスで起きたことを、うちに取り込みます。下のURLを相手に貼ってもらってください。合言葉は人に見せないでください。
      </Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {Object.entries(toggleFailures).map(([key, message]) => (
        <Notice key={key} tone="danger">{message}</Notice>
      ))}
      {Object.entries(toggleBusyNotices).map(([key, name]) => (
        <Notice key={key} tone="warn">「{name}」を送る設定：いま切り替えを送っています。返事が来るまでお待ちください。</Notice>
      ))}

      <div className={styles.body}>
        <div className={styles.inletCol}>
          {canManage
            ? <Button variant="primary" onClick={() => { setCreateFieldError({}); setShowCreate((open) => !open) }}>＋ 受け取り口を作る</Button>
            : <Button variant="primary" disabled title={manageReason}>＋ 受け取り口を作る</Button>}
          {!canManage ? <p className={styles.footNote}>受け取り口の作成は統括だけができます。</p> : null}
          {showCreate && canManage ? (
            <form className={styles.createBox} onSubmit={(e) => void handleCreateIncoming(e)}>
              <div>
                <label className={styles.label} htmlFor="webhook-v8-inlet-name">名前</label>
                <input
                  id="webhook-v8-inlet-name"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="申込フォーム"
                  className={styles.input}
                />
                {createFieldError.name ? <p className={styles.fieldError} role="alert">{createFieldError.name}</p> : null}
              </div>
              <div>
                <label className={styles.label} htmlFor="webhook-v8-inlet-source">どこから来るか</label>
                <Select
                  id="webhook-v8-inlet-source"
                  aria-label="どこから来るか"
                  value={createSource}
                  onChange={(value) => setCreateSource(value)}
                  options={[
                    ...SOURCE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
                    { value: SOURCE_OTHER, label: 'その他' },
                  ]}
                />
                {createSource === SOURCE_OTHER ? (
                  <input
                    value={createSourceFree}
                    onChange={(event) => setCreateSourceFree(event.target.value)}
                    placeholder="見本に無いものは「その他」を選べば自由に書けます"
                    className={styles.input}
                    aria-label="どこから来るか（自由入力）"
                  />
                ) : null}
              </div>
              <div>
                <label className={styles.label} htmlFor="webhook-v8-inlet-secret">合言葉（署名）</label>
                <div className={styles.secretRow}>
                  <input
                    id="webhook-v8-inlet-secret"
                    value={createSecret}
                    onChange={(event) => setCreateSecret(event.target.value)}
                    placeholder="相手と決めた合言葉"
                    className={styles.input}
                  />
                  <Button type="button" onClick={() => setCreateSecret(generateSecret())}>作り直す</Button>
                </div>
                {createFieldError.secret ? <p className={styles.fieldError} role="alert">{createFieldError.secret}</p> : null}
              </div>
              <div>
                <Button variant="secondary" type="submit" disabled={creating} busy={creating}>受け取り口を作る</Button>
              </div>
            </form>
          ) : null}
          <p className={styles.inletListLabel}>受け取り口</p>
          {incomingStatus === 'loading' ? (
            <div aria-busy="true" aria-label="受け取り口を読み込んでいます">
              <DelayedSkeleton
                loading
                skeleton={(
                  <div aria-hidden="true">
                    {[0, 1, 2, 3].map((row) => (
                      <div key={row} style={{ padding: '10px 12px' }}>
                        <Skeleton height={14} width="55%" />
                        <Skeleton className="mt-1" height={11} width="35%" />
                      </div>
                    ))}
                  </div>
                )}
              />
            </div>
          ) : null}
          {incomingStatus === 'error' ? (
            <ListState
              kind="error"
              title="受け取り口を読み込めませんでした"
              action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
            />
          ) : null}
          {readyCounts && incoming.length === 0 ? (
            <ListState kind="empty" title="まだ受け取り口がありません" />
          ) : null}
          {displayed.map((item) => {
            const isSelected = selected?.id === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`${styles.inletItem} ${isSelected ? styles.inletItemSelected : ''}`}
                aria-current={isSelected || undefined}
                aria-label={`受け取り口「${item.name}」を見る`}
              >
                <span className={styles.inletName}>{item.name}</span>
                <span className={styles.inletSub}>{item.isActive ? '動いている' : '止めている'}</span>
              </button>
            )
          })}
        </div>

        <div className={styles.main}>
          {!selectedAccountId ? (
            <ListState
              kind="empty"
              title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
            />
          ) : !selected ? (
            <ListState
              kind="empty"
              title="まだ受け取り口がありません"
              description="相手のサービスから知らせを受け取るURLを、「＋ 受け取り口を作る」から作成してください。"
            />
          ) : (
            <>
              <div className={styles.titleRow}>
                <h2 className={styles.title}>{selected.name}</h2>
                <span className={`${styles.pill} ${selected.isActive ? styles.pillActive : styles.pillNeutral}`}>
                  ● {toggling(selected.id) ? '切り替え中' : selected.isActive ? '動いています' : '止めています'}
                </span>
                {canManage ? (
                  <span className={styles.titleToggle}>
                    動かす
                    <Toggle
                      checked={selected.isActive}
                      label={`${selected.name}を動かす`}
                      onChange={() => void handleToggle(selected.id, selected.isActive)}
                    />
                  </span>
                ) : null}
              </div>
              {!canManage ? <p className={styles.footNote}>止める・合言葉の更新・削除は統括だけができます。</p> : null}

              <section className={styles.card} aria-labelledby="webhook-v8-receive-url">
                <h3 className={styles.cardTitle} id="webhook-v8-receive-url">どこから受け取るか</h3>
                <p className={styles.cardNote}>相手のサービスで「Webhook（ウェブフック）」の送り先にこの URL を貼ります</p>
                <div className={styles.urlRow}>
                  <code className={styles.urlBox} title={endpointUrl(selected.id)}>{endpointUrl(selected.id)}</code>
                  <Button onClick={() => void navigator.clipboard.writeText(endpointUrl(selected.id))}>写す</Button>
                </div>
                <div className={styles.fieldNote}>
                  <span className={styles.label}>合言葉（署名）</span>
                  <div className={styles.secretRow}>
                    <span className={styles.secretBox}>{selected.hasSecret ? '設定済み（再表示しません）' : '未設定'}</span>
                    {canManage ? (
                      <Button onClick={() => { setRotateTarget({ id: selected.id, name: selected.name, activate: false }); setRotateSecretValue('') }}>
                        合言葉を更新する
                      </Button>
                    ) : null}
                  </div>
                  <p className={styles.fieldNote}>合言葉は人に見せないでください。知られると、第三者がデータを送れるようになります。</p>
                </div>
              </section>

              <section className={styles.card} aria-labelledby="webhook-v8-identity">
                <h3 className={styles.cardTitle} id="webhook-v8-identity">だれの出来事か（人の見分けかた）</h3>
                <p className={styles.cardNote}>人が見つからないと何も起きません</p>
                <div className={styles.selectGrid}>
                  <div>
                    <p className={styles.label}>見分けに使う値</p>
                    <p className={styles.staticValue}>
                      {detailStatus === 'loading' ? '読み込んでいます' : detailStatus === 'error' ? '確認できませんでした' : identityMatchingLabel(detail)}
                    </p>
                  </div>
                  <div>
                    <p className={styles.label}>見つからないとき</p>
                    <p className={styles.staticValue}>
                      {detailStatus === 'loading' ? '読み込んでいます' : detailStatus === 'error' ? '確認できませんでした' : notFoundLabel(detail?.identityMatching.onNotFound)}
                    </p>
                  </div>
                </div>
              </section>

              <section className={styles.card} aria-labelledby="webhook-v8-actions">
                <h3 className={styles.cardTitle} id="webhook-v8-actions">届いたらすること</h3>
                <p className={styles.cardNote}>上から順に動きます</p>
                {detailStatus === 'loading' ? (
                  <p className={styles.cardNote}>保存されている処理を読み込んでいます。</p>
                ) : detailStatus === 'error' ? (
                  <ListState
                    kind="error"
                    title="届いた後の処理を表示できませんでした"
                    action={<Button onClick={() => setDetailReloadKey((key) => key + 1)}>詳細を読み直す</Button>}
                  />
                ) : detail && detail.actions.length > 0 ? (
                  <ol className={styles.actionList}>
                    {detail.actions.map((action, index) => (
                      <li key={`${action.refKind}-${index}`} className={styles.actionItem}>
                        <span className={styles.actionIndex}>{index + 1}</span>
                        <span className={styles.actionName}>{incomingActionLabel(action.refKind)}</span>
                        <span className={styles.actionTarget}>「{action.displayName}」</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.cardNote}>届いた後に動かす処理は、まだ設定されていません。</p>
                )}
              </section>

              {detail && (detail.identityMatching.onNotFound !== 'do_nothing' || unmatched.length > 0 || (detail.pendingUnmatched ?? 0) > 0 || unmatchedStatus === 'error') ? (
                <section className={styles.card} aria-labelledby="webhook-v8-unmatched">
                  <h3 className={styles.cardTitle} id="webhook-v8-unmatched">人が見つからなかった届物</h3>
                  <p className={styles.cardNote}>
                    {(detail.pendingUnmatched ?? 0) > 0 ? `${detail.pendingUnmatched}件。` : ''}結び付けると、届いたらすることが動きます
                  </p>
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
                      <table className={styles.unmatchedTable}>
                        <thead>
                          <tr><th scope="col">届いた日時</th><th scope="col">届いた値</th><th scope="col">候補</th><th scope="col">操作</th></tr>
                        </thead>
                        <tbody>
                          {unmatched.map((item) => (
                            <tr key={item.id}>
                              <td>{formatReceivedAt(item.receivedAt)}</td>
                              <td>
                                {item.identityAttempts.length > 0
                                  ? item.identityAttempts.map((attempt: { kind: string; value: string }) => `${identityKindLabel(attempt.kind)}：${attempt.value}`).join('、')
                                  : '照合に使える値が届いていません'}
                              </td>
                              <td>
                                {item.kind === 'candidate'
                                  ? '友だち候補'
                                  : item.kind === 'ambiguous'
                                    ? item.candidates.length > 0 ? `${item.candidates.length}人の友だちに一致` : '2人以上に一致'
                                    : '未照合'}
                              </td>
                              <td>
                                {item.kind === 'candidate' && item.candidates[0] && canResolveUnmatched ? (
                                  <Button
                                    disabled={dismissingId !== null}
                                    onClick={() => void resolveUnmatched(item, { action: 'link', friendId: item.candidates[0].friendId })}
                                    busy={dismissingId === item.id}
                                  >
                                    結び付ける
                                  </Button>
                                ) : canResolveUnmatched ? (
                                  <Button
                                    disabled={dismissingId !== null}
                                    onClick={() => void resolveUnmatched(item, { action: 'dismiss' })}
                                    busy={dismissingId === item.id}
                                  >
                                    {item.kind === 'ambiguous' ? 'どれでもない' : '確認した'}
                                  </Button>
                                ) : (
                                  <span className={styles.footNote}>統括または管理者に頼んでください</span>
                                )}
                                {unmatchedActionError && unmatchedActionError.id === item.id ? (
                                  <p role="alert" className={styles.fieldError}>{unmatchedActionError.message}</p>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(unmatchedTotal ?? detail.pendingUnmatched ?? 0) > unmatched.length ? (
                        <div>
                          <p className={styles.cardNote}>
                            ほか{(unmatchedTotal ?? detail.pendingUnmatched ?? 0) - unmatched.length}件あります。
                          </p>
                          <Button
                            disabled={unmatchedMoreBusy}
                            onClick={() => {
                              setUnmatchedMoreBusy(true)
                              setUnmatchedShown((shown) => shown + UNMATCHED_PAGE_SIZE)
                            }}
                            busy={unmatchedMoreBusy}
                          >
                            さらに表示
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              ) : null}

              <section className={styles.card} aria-labelledby="webhook-v8-try">
                <h3 className={styles.cardTitle} id="webhook-v8-try">届いたつもりで試す</h3>
                <p className={styles.cardNote}>見本の JSON で、どの人に届くかと何が動くかを確かめます。実際の処理は動きません</p>
                <pre className={styles.sampleBox}>{detail?.latestSample ? maskedSampleText(detail.latestSample.fields) : '{\n  "email": "kenta@example.com",\n  "フォーム": "体験申込"\n}'}</pre>
                <div>
                  <Button
                    onClick={() => {
                      setTestJson(detail?.latestSample ? '{\n  "friendId": "ここに届くデータの形を入れてください"\n}' : '')
                      setTestResult(null)
                      setTestError('')
                      setTestOpen(true)
                    }}
                  >
                    試す
                  </Button>
                </div>
                {canManage ? (
                  <div>
                    <Button onClick={() => askDelete(selected)}>削除する</Button>
                  </div>
                ) : null}
              </section>
            </>
          )}
          <p className={styles.footNote}>未処理（見つからなかった届物）の解消は、届物の表の「結び付ける」「確認した」から。</p>
        </div>
      </div>

      <Dialog
        open={testOpen}
        title="届いたつもりで試す"
        description="見本のJSONで、どの人に届くかと何が動くかを確かめます。実際の処理は動きません。"
        onCancel={() => setTestOpen(false)}
        footer={
          <div className={styles.titleRow} style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => void runIncomingTest()} disabled={testBusy || !testJson.trim()} busy={testBusy}>試す</Button>
          </div>
        }
      >
        <label className={styles.label} htmlFor="incoming-v8-test-json">届いたつもりのJSON</label>
        <textarea
          id="incoming-v8-test-json"
          className={styles.input}
          style={{ height: 144, paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace' }}
          value={testJson}
          onChange={(event) => setTestJson(event.target.value)}
          placeholder='{"friendId": "…"}'
        />
        {testError ? <p className={styles.fieldError} role="alert">{testError}</p> : null}
        {testResult ? (
          <div>
            <p className={styles.label}>だれに届くか</p>
            <p className={styles.staticValue}>
              {testResult.match.status === 'matched'
                ? '1人の友だちに一致しました'
                : testResult.match.status === 'ambiguous'
                  ? `同じ値の友だちが${testResult.match.friendIds.length}人います。実際に届くと保留になり、人が選びます。`
                  : '一致する友だちがいません'}
            </p>
            <p className={styles.label}>動く予定の処理</p>
            {testResult.actions.length > 0 ? (
              <ul className={styles.actionList}>
                {testResult.actions.map((action: IncomingWebhookTestResult['actions'][number]) => (
                  <li key={action.refIndex} className={styles.actionItem}>
                    <span className={styles.actionName}>{incomingActionLabel(action.refKind)}：{action.displayName}</span>
                    <span className={styles.actionTarget}>
                      {action.ok ? `(${action.plan?.length ?? 0}件の処理)` : action.error}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.staticValue}>動く処理はまだ設定されていません</p>
            )}
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
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />

      {rotateTarget && (
        <div ref={rotateModalRef} className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => void handleRotateSubmit(e)} role="dialog" aria-modal="true" aria-labelledby="webhook-v8-in-rotate-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 id="webhook-v8-in-rotate-title" className="text-lg font-semibold text-ink">
                「{rotateTarget.name}」の合言葉を{rotateTarget.activate ? '設定して有効化' : '更新する'}
              </h2>
            </div>
            <p className="text-sm text-ink-secondary mb-4">
              新しい合言葉を設定します。
              <strong className="text-danger">設定後は今回限り画面に表示されません。</strong>
              保存後も前の合言葉は24時間だけ使えるので、相手側の切り替え中も受信は止まりません。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-hairline rounded-control px-3 py-2 text-sm font-mono"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <Button type="button" onClick={() => setRotateSecretValue(generateSecret())}>
                自動生成
              </Button>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
              >
                キャンセル
              </Button>
              <Button type="submit" variant="primary">
                保存する
              </Button>
            </div>
          </form>
        </div>
      )}

      {createdSecret && (
        <Dialog
          open
          title="受け取り口を作りました"
          description="合言葉はこの画面で1回だけ表示します。相手のサービスに書き写してから閉じてください。"
          onCancel={() => setCreatedSecret(null)}
        >
          <p className={styles.label}>名前</p>
          <p className={styles.staticValue}>{createdSecret.name}</p>
          <p className={styles.label}>合言葉（今回だけ表示）</p>
          <p className={styles.secretOnce}>{createdSecret.secret}</p>
          <div className={styles.titleRow} style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => void navigator.clipboard.writeText(createdSecret.secret)}>写す</Button>
            <Button variant="primary" onClick={() => setCreatedSecret(null)}>閉じる</Button>
          </div>
        </Dialog>
      )}
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div>
  )
}
