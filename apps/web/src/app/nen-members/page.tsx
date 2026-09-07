'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  api,
  type PhotoAssetStatus,
  type PhotoDerivatives,
  type PhotoReviewMetrics,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import { formatPhotoReceivedAt } from './photo-review-time'
import { PhotoReviewDetail } from './photo-review-detail'
import { PhotoPublications } from './photo-publications'
import styles from './photo-review.module.css'

type PhotoStatus = 'pending' | 'adopted' | 'rejected'
type ReviewReasonCode = 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'
const REVIEW_REASONS: Array<{ value: ReviewReasonCode; label: string; message: string }> = [
  { value: 'privacy', label: 'ほかの人の顔が写っています', message: 'うしろに他のお客様が写っているようです。もう一度お願いできますか。' },
  { value: 'unrelated', label: 'ほかのお店のロゴや商品名が写っています', message: '商品の名前が入っていない写真をいただけますか。' },
  { value: 'quality', label: '暗くて見えにくいです', message: '明るいところで、もう一度お願いできますか。' },
  { value: 'other', label: '自分で書く', message: '文章をそのまま書きます。' },
]
const STATUS_TABS: ReadonlyArray<[PhotoStatus, string]> = [
  ['pending', '見ていないもの'],
  ['adopted', '通したもの'],
  ['rejected', '戻したもの'],
]
const text = (value: unknown) => String(value ?? '')

export default function PhotoReviewsPage() {
  const { selectedAccountId } = useAccount()
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [reviewMetrics, setReviewMetrics] = useState<PhotoReviewMetrics | null>(null)
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [view, setView] = useState<'list' | 'detail' | 'publications'>('list')
  const [detailPhoto, setDetailPhoto] = useState<Record<string, unknown> | null>(null)
  const [detailState, setDetailState] = useState<'ready' | 'empty' | 'error' | 'forbidden'>('empty')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAssetStatus, setDetailAssetStatus] = useState<PhotoAssetStatus | null>(null)
  const [detailDerivatives, setDetailDerivatives] = useState<PhotoDerivatives | null>(null)
  const [assetProcessing, setAssetProcessing] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadForbidden, setLoadForbidden] = useState(false)
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [rejectingPhotoId, setRejectingPhotoId] = useState<string | null>(null)
  const [rejectingPhotoDetail, setRejectingPhotoDetail] = useState<Record<string, unknown> | null>(null)
  const [reasonCode, setReasonCode] = useState<ReviewReasonCode>('privacy')
  const [reasonNote, setReasonNote] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false)
  const [bulkReturnOpen, setBulkReturnOpen] = useState(false)
  const [bulkReviewing, setBulkReviewing] = useState(false)
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    if (!selectedAccountId) {
      setPhotos([])
      setReviewMetrics(null)
      setLoadError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setReviewMetrics(null)
    setLoadError('')
    setLoadForbidden(false)
    const [photosResult, metricsResult] = await Promise.allSettled([
      api.nenMembers.photos(selectedAccountId),
      api.nenMembers.photoReviewMetrics(selectedAccountId),
    ])
    if (sequence !== loadSequence.current) return
    if (metricsResult.status === 'fulfilled' && metricsResult.value.success
      && isPhotoReviewMetrics(metricsResult.value.data)) {
      setReviewMetrics(metricsResult.value.data)
    } else {
      setReviewMetrics(null)
    }
    try {
      if (photosResult.status === 'rejected') throw photosResult.reason
      const response = photosResult.value
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error('load_failed')
      setPhotos(response.data)
    } catch (error) {
      if (sequence === loadSequence.current) {
        setPhotos([])
        const forbidden = error instanceof ApiError && error.status === 403
        setLoadForbidden(forbidden)
        setLoadError(forbidden ? '写真を見る権限がありません。' : '写真を読み込めませんでした。')
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [selectedAccountId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    setNotice('')
    setRejectingPhotoId(null)
    setRejectingPhotoDetail(null)
    setReasonCode('privacy')
    setReasonNote('')
    setReasonError('')
    setView('list')
    setDetailPhoto(null)
    setDetailAssetStatus(null)
    setDetailDerivatives(null)
    setSelectedPhotoIds([])
    setBulkApproveOpen(false)
    setBulkReturnOpen(false)
  }, [selectedAccountId])

  const counts = useMemo(() => ({
    all: photos.length,
    pending: photos.filter((photo) => text(photo.status) === 'pending').length,
    adopted: photos.filter((photo) => text(photo.status) === 'adopted').length,
    rejected: photos.filter((photo) => text(photo.status) === 'rejected').length,
  }), [photos])
  const visiblePhotos = useMemo(() => photos.filter((photo) => text(photo.status) === status), [photos, status])
  const reviewedIn30Days = useMemo(() => {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000
    return photos.filter((photo) => {
      const reviewedAt = Date.parse(text(photo.reviewed_at))
      return text(photo.status) !== 'pending' && Number.isFinite(reviewedAt) && reviewedAt >= threshold
    }).length
  }, [photos])
  const countsReady = Boolean(selectedAccountId) && !loading && !loadError
  const reviewedStatsReady = countsReady && photos
    .filter((photo) => text(photo.status) !== 'pending')
    .every((photo) => Number.isFinite(Date.parse(text(photo.reviewed_at))))
  /*
   * 戻した理由の内訳。いま読み込んでいる写真から数える。取れない数を
   * 0で埋めないよう、読み込み前・失敗時は `countsReady` 側で `—` にする。
   */
  const reasonCounts = useMemo(() => {
    const tally: Record<ReviewReasonCode, number> = {
      quality: 0, privacy: 0, unrelated: 0, duplicate: 0, other: 0,
    }
    for (const photo of photos) {
      if (text(photo.status) !== 'rejected') continue
      const code = text(photo.review_reason_code) as ReviewReasonCode
      if (code in tally) tally[code] += 1
    }
    return tally
  }, [photos])
  const rejectingPhoto = rejectingPhotoDetail
    ?? photos.find((photo) => text(photo.id) === rejectingPhotoId)
    ?? null
  const selectedReason = REVIEW_REASONS.find((reason) => reason.value === reasonCode)
  const selectedReasonLabel = selectedReason?.label ?? ''
  const selectedReasonMessage = selectedReason?.message ?? ''

  const refreshDetailAssets = async (id: string, accountId: string) => {
    const [statusResult, derivativesResult] = await Promise.allSettled([
      api.nenMembers.photoAssetStatus(id, accountId),
      api.nenMembers.photoDerivatives(id, accountId),
    ])
    setDetailAssetStatus(statusResult.status === 'fulfilled' && statusResult.value.success
      && isPhotoAssetStatus(statusResult.value.data)
      ? statusResult.value.data
      : null)
    setDetailDerivatives(derivativesResult.status === 'fulfilled' && derivativesResult.value.success
      && isPhotoDerivatives(derivativesResult.value.data)
      ? derivativesResult.value.data
      : null)
  }

  const openDetail = async (id: string) => {
    if (!selectedAccountId) return
    setView('detail')
    setDetailPhoto(null)
    setDetailAssetStatus(null)
    setDetailDerivatives(null)
    setDetailLoading(true)
    try {
      const [response] = await Promise.all([
        api.nenMembers.photo(id, selectedAccountId),
        refreshDetailAssets(id, selectedAccountId),
      ])
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setDetailState('empty')
        return
      }
      setDetailPhoto(response.data)
      setDetailState('ready')
    } catch (error) {
      setDetailState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    } finally { setDetailLoading(false) }
  }

  const openRejectDialog = async (id: string, knownPhoto?: Record<string, unknown>) => {
    setRejectingPhotoId(id)
    setRejectingPhotoDetail(knownPhoto ?? null)
    setReasonCode('privacy')
    setReasonNote('')
    setReasonError('')
    if (!selectedAccountId || knownPhoto) return
    try {
      const response = await api.nenMembers.photo(id, selectedAccountId)
      if (response.success && !Array.isArray(response.data)) setRejectingPhotoDetail(response.data)
    } catch {
      // 一覧の情報で窓を開いたままにする。詳細取得失敗で審査操作を止めない。
    }
  }

  const pendingPhotos = photos.filter((photo) => text(photo.status) === 'pending')
  const selectedPendingPhotos = pendingPhotos.filter((photo) => selectedPhotoIds.includes(text(photo.id)))
  const selectedPhotosAreLowRisk = selectedPendingPhotos.length > 0
    && selectedPendingPhotos.every((photo) => ['safe', 'none', 'low'].includes(text(photo.latest_risk_flag)))
  const detailPosition = detailPhoto
    ? Math.max(0, pendingPhotos.findIndex((photo) => text(photo.id) === text(detailPhoto.id)))
    : 0

  const review = async (
    id: string,
    nextStatus: 'adopted' | 'rejected',
    rejection?: { reasonCode: ReviewReasonCode; reasonNote: string },
  ) => {
    if (!selectedAccountId) {
      setNotice('LINEアカウントを選んでください。')
      return
    }
    setReviewing(id)
    try {
      const response = await api.nenMembers.reviewPhoto(id, {
        accountId: selectedAccountId,
        status: nextStatus,
        expectedVersion: Number(
          photos.find((photo) => text(photo.id) === id)?.review_version
          ?? (text(detailPhoto?.id) === id ? detailPhoto?.review_version : 1),
        ),
        ...(rejection ?? {}),
      })
      if (!response.success) throw new Error(response.error)
      const notification = response.data.notificationStatus === 'sent'
        ? '投稿者へLINEで通知しました。'
        : '審査結果は保存しましたが、LINE通知は送れませんでした。一覧から再送できます。'
      setNotice(nextStatus === 'adopted'
        ? `写真を通し、ECへ${response.data.awardedPoints}ポイントを付ける手続きを始めました。公開は本人の同意がある場合だけ行います。${notification}`
        : `戻す理由を保存しました。${notification}`)
      setRejectingPhotoId(null)
      setRejectingPhotoDetail(null)
      setReasonCode('privacy')
      setReasonNote('')
      setReasonError('')
      await load()
      setView('list')
    } catch (error) { setNotice(error instanceof Error ? error.message : '審査結果を保存できませんでした。') }
    finally { setReviewing(null) }
  }

  const bulkReview = async (
    decision: 'approve' | 'return',
    rejection?: { reasonCode: ReviewReasonCode; reasonNote: string },
  ) => {
    if (!selectedAccountId || selectedPendingPhotos.length === 0) return
    setBulkReviewing(true)
    try {
      const response = await api.nenMembers.bulkReviewPhotos({
        lineAccountId: selectedAccountId,
        decisions: selectedPendingPhotos.map((photo) => ({
          photoId: text(photo.id),
          decision,
          expectedVersion: Number(photo.review_version ?? 1),
          reasonCode: rejection?.reasonCode ?? null,
          reasonNote: rejection?.reasonNote || null,
        })),
      }, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      const notification = response.data.notificationFailures > 0
        ? `うち${response.data.notificationFailures}件はLINE通知を送れませんでした。`
        : '投稿者へのLINE通知も送信しました。'
      setNotice(`${response.data.updatedCount}枚の審査結果を保存しました。${notification}`)
      setSelectedPhotoIds([])
      setBulkApproveOpen(false)
      setBulkReturnOpen(false)
      setReasonCode('privacy')
      setReasonNote('')
      setReasonError('')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'まとめて審査できませんでした。')
    } finally {
      setBulkReviewing(false)
    }
  }

  const processReviewAsset = async () => {
    if (!selectedAccountId || !detailPhoto) return
    const id = text(detailPhoto.id)
    setAssetProcessing(true)
    try {
      const response = await api.nenMembers.processPhotoAssets(id, {
        lineAccountId: selectedAccountId,
        expectedVersion: Number(detailPhoto.review_version ?? 1),
        operation: 'review',
      }, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setNotice(response.data.status === 'completed'
        ? '審査用画像を作り直しました。'
        : '審査用画像の作り直しを受け付けました。')
      await refreshDetailAssets(id, selectedAccountId)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '審査用画像を作り直せませんでした。')
    } finally {
      setAssetProcessing(false)
    }
  }

  const downloadOriginal = async (code: string) => {
    if (!selectedAccountId || !detailPhoto) throw new Error('写真を読み直してください。')
    let grant
    try {
      grant = await api.nenMembers.photoOriginalStepUp(code)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
        throw new Error('再認証コードを確認してください。')
      }
      throw error
    }
    if (!grant.success) throw new Error(grant.error)
    const issued = await api.nenMembers.issuePhotoOriginalDownload(
      text(detailPhoto.id),
      { lineAccountId: selectedAccountId, expectedVersion: Number(detailPhoto.review_version ?? 1) },
      grant.data.token,
      crypto.randomUUID(),
    )
    if (!issued.success) throw new Error(issued.error)
    const blob = await api.nenMembers.downloadPhotoOriginal(issued.data.downloadUrl)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `photo-${text(detailPhoto.id)}-original`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (view === 'publications' && selectedAccountId) {
    return <PhotoPublications accountId={selectedAccountId} onBack={() => setView('list')} />
  }

  if (view === 'detail') {
    return <PhotoReviewDetail
      photo={detailPhoto}
      position={detailPosition}
      total={pendingPhotos.length}
      loading={detailLoading}
      loadKind={detailState}
      reviewing={Boolean(reviewing)}
      notice={notice}
      assetStatus={detailAssetStatus}
      derivatives={detailDerivatives}
      assetProcessing={assetProcessing}
      onBack={() => setView('list')}
      onMove={(direction) => {
        const next = pendingPhotos[detailPosition + direction]
        if (next) void openDetail(text(next.id))
      }}
      onApprove={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted') }}
      onReturn={() => {
        if (!detailPhoto) return
        setView('list')
        void openRejectDialog(text(detailPhoto.id), detailPhoto)
      }}
      onProcessReviewAsset={() => processReviewAsset()}
      onDownloadOriginal={downloadOriginal}
    />
  }

  const retryNotification = async (id: string) => {
    if (!selectedAccountId) return
    setReviewing(id)
    try {
      const response = await api.nenMembers.retryPhotoReviewNotification(id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      setNotice('審査結果を投稿者へLINEで再送しました。')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'LINE通知を再送できませんでした。')
    } finally {
      setReviewing(null)
    }
  }

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotoIds((current) => current.includes(id)
      ? current.filter((photoId) => photoId !== id)
      : [...current, id])
  }

  return <>
    <main className="mx-auto flex max-w-full flex-col gap-4 p-4 sm:p-6">
      {notice && <div className="rounded-control border border-accent-border bg-accent-soft px-4 py-3 text-sm text-accent-hover">{notice}</div>}

      {/*
        * 状態の切り替えはタブ帯（高さ44）で出す。設計 `Qu6Vk` は共通の
        * ページ内タブで、押しボタンを並べた帯ではない。件数が取れていない
        * ときは `—` を出す。0件と読み替えない。
        */}
      <Tabs
        items={[
          ...STATUS_TABS.map(([value, label]) => ({
            label: `${label}（${countsReady ? counts[value] : '—'}）`,
            current: status === value,
            onClick: () => setStatus(value),
          })),
          { label: '出しているもの', current: false, onClick: () => setView('publications') },
        ]}
      />

      <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-secondary">見ていない写真</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {reviewMetrics ? reviewMetrics.pendingCount : countsReady ? counts.pending : '—'}
            <span className="ml-0.5 text-xs font-normal text-ink-faint">枚</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">{reviewMetrics?.oldestPendingAt ? `いちばん古いものは${formatPhotoReceivedAt(reviewMetrics.oldestPendingAt)}` : countsReady && counts.pending > 0 ? '古いものから確認してください' : '新しい写真をお待ちしています'}</p>
        </div>
        <div className="rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-secondary">この30日に見た</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {reviewedStatsReady ? reviewedIn30Days : '—'}
            <span className="ml-0.5 text-xs font-normal text-ink-faint">枚</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">読み込んだ写真の審査日時から集計</p>
        </div>
        <div className="rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-secondary">1枚にかかる時間</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatAverageReviewTime(reviewMetrics?.averageReviewMinutes)}</p>
          <p className="mt-0.5 text-xs text-ink-faint">審査を始めてから保存するまでの平均</p>
        </div>
        <div className="rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-secondary">気をつけたい写真</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{reviewMetrics ? reviewMetrics.attentionCount : '—'}<span className="ml-0.5 text-xs font-normal text-ink-faint">枚</span></p>
          <p className="mt-0.5 text-xs text-ink-faint">自動判定は確認順の補助だけに使います</p>
        </div>
      </div>

      <div className="rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent">
        通す・戻すを押した時点で、投稿者へお礼や直してほしい点が届きます。戻すときは理由を選び、送る文章を確認できます。
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-control bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">{selectedPhotoIds.length}枚を選択中</span>
          <Button variant="primary" disabled={!selectedPhotosAreLowRisk || bulkReviewing} title={!selectedPhotosAreLowRisk && selectedPendingPhotos.length > 0 ? 'まとめて通せるのは、注意候補がない写真だけです' : undefined} onClick={() => setBulkApproveOpen(true)}>{bulkReviewing ? '処理中...' : 'まとめて通す'}</Button>
          <Button variant="secondary" disabled={selectedPendingPhotos.length === 0 || bulkReviewing} onClick={() => setBulkReturnOpen(true)}>まとめて戻す</Button>
          <span className="text-xs text-ink-faint">審査待ちの写真だけをまとめて処理します</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled>▦ 並べて見る</Button>
          <Button
            data-qa-open="hHrz8"
            variant="secondary"
            disabled={!visiblePhotos.length}
            onClick={() => { const first = visiblePhotos[0]; if (first) void openDetail(text(first.id)) }}
          >
            ⛶ 1枚ずつ大きく見る
          </Button>
        </div>
      </div>

      <div className={styles.body}>
      <div className="min-w-0 space-y-6">
      {!selectedAccountId ? <ListState kind="empty" title="LINEアカウントを選んでください" description="上のバーから、写真審査を行うLINEアカウントを選びます。" /> : loading ? <ListState kind="loading" title="写真を読み込んでいます" /> : loadForbidden ? <ListState kind="forbidden" title="写真を見る権限がありません" description="管理者へ写真審査の閲覧権限を確認してください。" /> : loadError ? <ListState kind="error" title="写真を読み込めませんでした" description="通信状態を確認して、もう一度読み込んでください。" onRetry={() => void load()} /> : visiblePhotos.length === 0 ? <ListState kind="empty" title="この状態の写真はありません" description="別の状態を選ぶか、新しい写真が届くまでお待ちください。" /> : <section className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-4">
        {visiblePhotos.map((photo) => {
          const photoId = text(photo.id)
          const selected = selectedPhotoIds.includes(photoId)
          return <article key={photoId} className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card" style={selected ? { borderColor: 'var(--color-accent)', boxShadow: '0 0 0 1px var(--color-accent)' } : undefined}>
          <div className="relative h-40 overflow-hidden bg-canvas-sunken">
            <img src={text(photo.image_url)} alt={`${photoPetName(photo)}の投稿写真`} className="h-full w-full object-cover" />
            <label className="absolute left-2 top-2 flex cursor-pointer items-center gap-1.5 rounded-control border border-hairline bg-canvas px-2 py-1 text-xs font-semibold text-ink-secondary"><input type="checkbox" checked={selected} onChange={() => togglePhotoSelection(photoId)} className="accent-accent" /><span>選ぶ</span></label>
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-ink">{photoPetName(photo)}</p><p className="mt-1 text-xs text-ink-faint">{text(photo.owner_name) || '名前未取得'}・{formatPhotoReceivedAt(photo.created_at)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${photo.status === 'pending' ? 'bg-status-warn-soft text-status-warn-deep' : photo.status === 'adopted' ? 'bg-accent-soft text-accent-hover' : 'bg-canvas-sunken text-ink-faint'}`}>{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '通しました' : '戻しました'}</span></div>
            <p className="mt-2 min-h-5 truncate text-sm text-ink-secondary" title={text(photo.caption) || 'コメントなし'}>{text(photo.caption) || 'コメントなし'}</p>
            {text(photo.latest_risk_flag) && !['safe', 'none', 'low'].includes(text(photo.latest_risk_flag)) && <p className="mt-2 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep">注意候補：{photoRiskLabel(text(photo.latest_risk_flag))}</p>}
            {photo.status === 'adopted' && <p className="mt-3 rounded-control bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-hover">5ポイント付与済み・{photo.publication_consent_at && !photo.publication_withdrawn_at ? '公開中' : '公開は未同意'}</p>}
            {photo.status === 'rejected' && <div className="mt-3 rounded-control bg-surface-pearl px-3 py-2 text-xs text-ink-secondary"><span className="font-semibold">見送った理由：</span>{REVIEW_REASONS.find((reason) => reason.value === photo.review_reason_code)?.label ?? '理由未記録'}{text(photo.review_reason_note) && <p className="mt-1 text-ink-faint">{text(photo.review_reason_note)}</p>}</div>}
            {photo.review_notification_status === 'failed' && <div className="mt-2 flex items-center justify-between gap-3 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep"><span>投稿者へのLINE通知を送れませんでした</span><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => void retryNotification(text(photo.id))} className="shrink-0">{reviewing === photo.id ? '再送中...' : 'LINE通知を再送'}</Button></div>}
            {photo.status === 'pending' && <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="primary" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'adopted')}>{reviewing === photo.id ? '処理中...' : '通す'}</Button><Button data-qa-open={photoId === text(visiblePhotos[0]?.id) && status === 'pending' ? 'N2J629' : undefined} variant="secondary" disabled={reviewing === photo.id} onClick={() => void openRejectDialog(photoId)}>戻す</Button></div>}
          </div>
        </article>})}
      </section>}
      </div>

      <div data-design="Right" className={styles.stack}>
        <section className={styles.sideCard}>
          <h2 className={styles.sideTitle}>確認順を決める条件</h2>
          <p className={styles.sideMissingValue}>{reviewMetrics ? `${reviewMetrics.attentionCount}枚` : '—'}</p>
          <p className={styles.sideNote}>
            自動で見つけた注意候補の総数です。通す・戻す・公開する判断は、必ず人が行います。
          </p>
        </section>

        <section className={styles.sideCard}>
          <h2 className={styles.sideTitle}>戻す理由の内訳</h2>
          {countsReady ? (
            REVIEW_REASONS.map((reason) => (
              <div key={reason.value} className={styles.reasonRow}>
                <span className={styles.reasonName}>{reason.label}</span>
                <span className={styles.reasonCount}>{reasonCounts[reason.value]}件</span>
              </div>
            ))
          ) : (
            <p className={styles.sideMissingValue}>—</p>
          )}
          <p className={styles.sideNote}>
            {countsReady
              ? 'いま読み込んでいる写真のうち、戻したものを理由ごとに数えています。理由を記録していないものは数えません。'
              : loadError
                ? '読み込めませんでした'
                : '読み込んでいます'}
          </p>
        </section>

        <FeatureLinkCard
          items={[
            { label: '受信箱', note: '写真が届いたやりとり', href: '/chats' },
            { label: '友だち', note: 'この人の過去の投稿', href: '/friends' },
            { label: 'EC連携', note: 'ポイントの付与先です', href: '/ec-commerce' },
            { label: '登録メディア', note: '通した写真の置き場', href: '/contents' },
            { label: 'テンプレート', note: 'お礼とお願いの文章', href: '/templates' },
          ]}
        />
      </div>
      </div>
    </main>
    <Dialog open={bulkApproveOpen} title={`${selectedPendingPhotos.length}枚をまとめて通す`} description="選択した写真の件数、ポイント、公開範囲を確認してください。" busy={bulkReviewing} confirmLabel="まとめて通す" cancelLabel="審査へ戻る" onCancel={() => setBulkApproveOpen(false)} onConfirm={() => void bulkReview('approve')}>
      <dl className="space-y-3 rounded-control bg-surface-pearl p-4 text-sm text-ink-secondary">
        <div className="flex justify-between gap-4"><dt>写真</dt><dd className="font-semibold text-ink">{selectedPendingPhotos.length}枚</dd></div>
        <div className="flex justify-between gap-4"><dt>付与するポイント</dt><dd className="font-semibold text-ink">合計 {selectedPendingPhotos.length * 5}ポイント</dd></div>
        <div className="flex justify-between gap-4"><dt>公開範囲</dt><dd className="font-semibold text-ink">公開しない</dd></div>
      </dl>
      <p className="mt-3 text-xs text-ink-faint">写真を通しても自動公開しません。本人の公開同意を確認したあと、出しているもの画面で公開先を選びます。</p>
    </Dialog>
    {rejectingPhoto && <Dialog open title="この写真を戻しますか？" description="理由をえらぶと、お客様への文章が自動でつくられます。" busy={Boolean(reviewing)} error={reasonError} confirmLabel="戻して、この文章を送る" cancelLabel="やめる" onCancel={() => { setRejectingPhotoId(null); setRejectingPhotoDetail(null); setReasonError('') }} onConfirm={() => {
      if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
      void review(text(rejectingPhoto.id), 'rejected', { reasonCode, reasonNote: reasonNote.trim() })
    }}>
        <div className="space-y-4">
            <div className="grid grid-cols-[64px_1fr] items-center gap-3 rounded-control bg-surface-pearl px-3 py-2 text-sm text-ink-secondary">
              <img src={text(rejectingPhoto.image_url)} alt="" className="h-16 w-16 rounded-control object-cover" />
              <div>
              <p className="font-semibold text-ink">
                {photoPetName(rejectingPhoto)}／{text(rejectingPhoto.owner_name) || 'お名前は未取得'}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {formatPhotoReceivedAt(rejectingPhoto.created_at)} に届きました
              </p>
              <p className="mt-1 text-xs text-ink-faint">{Number.isFinite(Number(rejectingPhoto.returned_count)) ? Number(rejectingPhoto.returned_count) === 0 ? 'この方を戻すのははじめてです' : `この方を戻したこと ${Number(rejectingPhoto.returned_count)}回` : 'この方を前に戻した回数は未取得です'}</p>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink">どうして戻しますか</legend>
              {REVIEW_REASONS.map((reason) => <label key={reason.value} className="flex cursor-pointer items-start gap-2 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink-secondary"><input type="radio" name="photo-review-reason" value={reason.value} checked={reasonCode === reason.value} onChange={() => { setReasonCode(reason.value); setReasonError('') }} className="mt-0.5" /><span><span className="font-medium text-ink">{reason.label}</span><span className="mt-1 block text-xs text-ink-faint">「{reason.message}」</span></span></label>)}
            </fieldset>
            <label className="block text-sm font-semibold text-ink">お客様に届く補足（直せます）<textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value.slice(0, 500)); setReasonError('') }} rows={2} placeholder={reasonCode === 'other' ? 'お客様に送る文章を書いてください' : '必要な場合だけ補足します'} className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
            <div className="rounded-control border border-accent-border bg-accent-soft p-3 text-sm text-ink-secondary"><p className="font-semibold text-ink">お客様にはこう届きます（直せます）</p><p className="mt-1 whitespace-pre-line">{photoPetName(rejectingPhoto)}の写真をありがとうございます。{reasonCode === 'other' ? reasonNote || 'お客様に送る文章を入力してください。' : selectedReasonMessage}{reasonNote && reasonCode !== 'other' ? `\n${reasonNote}` : ''}{`\n`}お手数をおかけします。</p></div>
            <label className="flex items-start gap-2 text-sm text-ink-secondary"><input type="checkbox" disabled className="mt-0.5" /><span><span className="font-semibold text-ink">もう一度 送ってもらえるようお願いする</span><span className="block text-xs text-ink-faint">写真を送るボタンの保存先はまだ接続されていません。</span></span></label>
            <label className="flex items-start gap-2 text-sm text-ink-secondary"><input type="checkbox" disabled className="mt-0.5" /><span><span className="font-semibold text-ink">この人の次の投稿は、必ず人が見る</span><span className="block text-xs text-ink-faint">要注意投稿者の保存先はまだ接続されていません。</span></span></label>
            <p className="text-xs font-semibold text-ink-faint">戻しても、この方のマイルは減りません。</p>
        </div>
    </Dialog>}
    <Dialog open={bulkReturnOpen} title={`${selectedPendingPhotos.length}枚をまとめて戻す`} description="選んだ理由と補足は、選択した写真すべてに記録され、投稿者へLINEで届きます。" tone="destructive" busy={bulkReviewing} error={reasonError} confirmLabel="この理由でまとめて戻す" cancelLabel="審査へ戻る" onCancel={() => { setBulkReturnOpen(false); setReasonError('') }} onConfirm={() => {
      if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
      void bulkReview('return', { reasonCode, reasonNote: reasonNote.trim() })
    }}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">戻す理由</legend>
        {REVIEW_REASONS.map((reason) => <label key={reason.value} className="flex cursor-pointer items-start gap-2 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink-secondary"><input type="radio" name="photo-bulk-review-reason" value={reason.value} checked={reasonCode === reason.value} onChange={() => { setReasonCode(reason.value); setReasonError('') }} className="mt-0.5" /><span className="font-medium text-ink">{reason.label}</span></label>)}
      </fieldset>
      <label className="mt-4 block text-sm font-semibold text-ink">投稿者に届く補足（直せます）<textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value.slice(0, 500)); setReasonError('') }} rows={3} placeholder={reasonCode === 'other' ? '理由を入力してください' : '必要な場合だけ入力します'} className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
      <div className="mt-4 rounded-control border border-accent-border bg-accent-soft p-3 text-sm text-ink-secondary"><p className="font-semibold text-ink">投稿者に届く内容</p><p className="mt-1 whitespace-pre-line">お写真をご投稿いただきありがとうございます。{`\n`}今回は「{selectedReasonLabel}」のため、掲載を見送らせていただきました。{reasonNote && `\n${reasonNote}`}{`\n`}内容をご確認のうえ、よろしければ別のお写真をご投稿ください。</p></div>
    </Dialog>
  </>
}

function formatAverageReviewTime(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  if (minutes < 1) return `平均 ${Math.max(1, Math.round(minutes * 60))}秒`
  return `平均 ${Math.round(minutes)}分`
}

function photoRiskLabel(flag: string) {
  if (flag === 'face') return '人の顔らしきもの'
  if (flag === 'blur') return 'ぼやけ'
  if (flag === 'dark') return '暗さ'
  if (flag === 'logo') return '他社ロゴらしきもの'
  if (flag === 'duplicate') return '重複らしきもの'
  return flag
}

function photoPetName(photo: Record<string, unknown>) {
  const name = text(photo.pet_name) || 'ペット'
  return /(?:ちゃん|くん|さん)$/.test(name) ? name : `${name}ちゃん`
}

function isPhotoReviewMetrics(value: unknown): value is PhotoReviewMetrics {
  if (!value || typeof value !== 'object') return false
  const metrics = value as Partial<PhotoReviewMetrics>
  return Number.isFinite(metrics.pendingCount)
    && Number.isFinite(metrics.reviewedCount)
    && Number.isFinite(metrics.attentionCount)
    && (metrics.averageReviewMinutes == null || Number.isFinite(metrics.averageReviewMinutes))
    && (metrics.oldestPendingAt == null || typeof metrics.oldestPendingAt === 'string')
}

function isPhotoAssetStatus(value: unknown): value is PhotoAssetStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<PhotoAssetStatus>
  return Number.isFinite(status.reviewVersion) && Array.isArray(status.jobs)
}

function isPhotoDerivatives(value: unknown): value is PhotoDerivatives {
  if (!value || typeof value !== 'object') return false
  const derivatives = value as Partial<PhotoDerivatives>
  return Number.isFinite(derivatives.reviewVersion)
    && Array.isArray(derivatives.items)
    && Array.isArray(derivatives.knownUrls)
}
