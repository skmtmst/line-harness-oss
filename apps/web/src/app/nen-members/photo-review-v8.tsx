'use client'

/*
 * ★V8-B 投稿（Pencil「★V8-B 画面の地図」専用機能の組：
 * 写真の審査 `TkA4D`、閲覧のみ `Jn95h`、採用 `cniyw`、
 * 公式サイト掲載 `SyQA1`、見送る確認 `ujcar`、
 * 報酬の決まり 版の履歴 `N1br7`、状態の板 `dzx5D`）。
 *
 * v7（nen-members/page.tsx と photo-review-detail / photo-publications /
 * photo-reward-policy）とは別の部品として持ち、data-theme="v8" のときだけ
 * こちらが出る。データの口（photos・metrics・review・bulk・retry・
 * publications・withdraw・policyVersions）は同じ。違いは置き場と見せ方だけ——
 * ・数の帯は1枚の白い板に区切り線で4つ（離したカードにしない）。
 * ・審査はカードの並び＋右に決まりの棚。1画面に主ボタンは置かない。
 * ・見送る確認は真ん中の小窓（ujcar）。版の履歴は N1br7 の窓。
 * ・1枚ずつ大きく見るは今の作りのまま。掲載順は全件と版を確認して保存する
 *  （詳細は v7 の部品をそのまま使う）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CircleCheck, Clock3, Globe } from 'lucide-react'
import type { ApiResponse } from '@line-crm/shared'
import { ApiError, api, fetchApi, type PhotoBulkReviewResult, type PhotoReviewMetrics } from '@/lib/api'
import Button from '@/components/shared/button'
import BulkBar from '@/components/shared/bulk-bar'
import Checkbox from '@/components/shared/checkbox'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import { notifyToast } from '@/components/shared/toast'
import { Tabs } from '@/components/shared/tabs'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { formatNumber } from '@/lib/format'
import { photoPetDisplayName } from '@/components/shared/photo-display-name'
import { formatPhotoReceivedAt } from './photo-review-time'
import { safePhotoSrc } from './photo-src'
import { photoNoticeFor } from './photo-notice'
import { mileStatusLabel, reviewVersionOf, text } from './photo-text'
import { PhotoReviewDetail } from './photo-review-detail'
import { PhotoRewardPolicyDrawer } from './photo-reward-policy'
import type { PhotoRewardPolicyVersion } from '@/lib/api'
import styles from './photo-review-v8.module.css'

type PhotoStatus = 'pending' | 'adopted' | 'rejected'
type PhotoView = 'list' | 'detail' | 'publications'
type ReviewReasonCode = 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'

/* 見送った理由（v7 と同じ5つ。選ぶとお客様への文章が自動でつくられる）。 */
const REVIEW_REASONS: Array<{ value: ReviewReasonCode; label: string; message: string }> = [
  { value: 'quality', label: '暗くて見えにくいです', message: '明るいところで、もう一度お願いできますか。' },
  { value: 'privacy', label: 'ほかの人の顔が写っています', message: 'うしろに他のお客様が写っているようです。もう一度お願いできますか。' },
  { value: 'unrelated', label: 'ほかのお店のロゴや商品名が写っています', message: '商品の名前が入っていない写真をいただけますか。' },
  { value: 'duplicate', label: '同じ写真をすでにもらっています', message: 'すでにいただいた写真と重複しているようです。別のお写真をお願いできますか。' },
  { value: 'other', label: '自分で書く', message: '文章をそのまま書きます。' },
]

const PHOTO_PAGE_SIZE = 200
function photoPagePath(accountId: string, offset: number, q = ''): string {
  const params = new URLSearchParams({ accountId, limit: String(PHOTO_PAGE_SIZE) })
  if (offset > 0) params.set('offset', String(offset))
  if (q) params.set('q', q)
  return `/api/nen-members/photos?${params.toString()}`
}
type PhotoPageResponse = ApiResponse<Array<Record<string, unknown>>>

/** 板ごとの data-design-node（札・見せ方で切り替える外枠の印）。 */
function boardNode(view: PhotoView, status: PhotoStatus, canEdit: boolean): string {
  if (view === 'publications') return 'SyQA1'
  if (status === 'adopted') return 'cniyw'
  if (!canEdit) return 'Jn95h'
  return 'TkA4D'
}

function isThisMonth(value: string): boolean {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return false
  const now = new Date()
  const date = new Date(time)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

/**
 * 投稿の V8 画面。外枠（見出し・版の履歴・札・数の帯）は全部の札で同じ。
 */
export default function PhotoReviewV8({ accountId }: { accountId: string | null }) {
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [reviewMetrics, setReviewMetrics] = useState<PhotoReviewMetrics | null>(null)
  const [policyPoints, setPolicyPoints] = useState<number | null>(null)
  const [publishedCount, setPublishedCount] = useState<number | null>(null)
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [view, setView] = useState<PhotoView>('list')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadForbidden, setLoadForbidden] = useState(false)
  const [hasMorePhotos, setHasMorePhotos] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  // 審査・見送りの口は owner/admin だけ。staff は見るだけ（Jn95h）。
  const [canEdit, setCanEdit] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const loadSequence = useRef(0)
  const accountGeneration = useRef(0)
  const reviewKeys = useRef(new Map<string, string>())

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanEdit(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    if (!accountId) {
      setPhotos([])
      setReviewMetrics(null)
      setPolicyPoints(null)
      setPublishedCount(null)
      setLoadError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    setLoadForbidden(false)
    setHasMorePhotos(false)
    const [photosResult, metricsResult, policyResult, publicationsResult] = await Promise.allSettled([
      fetchApi<PhotoPageResponse>(photoPagePath(accountId, 0, searchQuery)),
      api.nenMembers.photoReviewMetrics(accountId),
      api.nenMembers.photoRewardPolicyVersions(),
      api.nenMembers.photoPublications(accountId),
    ])
    if (sequence !== loadSequence.current) return
    if (metricsResult.status === 'fulfilled' && metricsResult.value.success) {
      setReviewMetrics(metricsResult.value.data)
    } else {
      setReviewMetrics(null)
    }
    if (policyResult.status === 'fulfilled' && policyResult.value.success) {
      const current = policyResult.value.data.find((v) => v.status === 'in_use') ?? null
      setPolicyPoints(current ? current.points : null)
    } else {
      setPolicyPoints(null)
    }
    if (publicationsResult.status === 'fulfilled' && publicationsResult.value.success && !Array.isArray(publicationsResult.value.data)) {
      setPublishedCount(publicationsResult.value.data.summary.publishedCount)
    } else {
      setPublishedCount(null)
    }
    try {
      if (photosResult.status === 'rejected') throw photosResult.reason
      const response = photosResult.value
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error('load_failed')
      setPhotos(response.data)
      setHasMorePhotos(response.data.length === PHOTO_PAGE_SIZE)
    } catch (error) {
      if (sequence === loadSequence.current) {
        setPhotos([])
        setHasMorePhotos(false)
        const forbidden = error instanceof ApiError && error.status === 403
        setLoadForbidden(forbidden)
        setLoadError(forbidden ? '写真を見る権限がありません。' : '写真を読み込めませんでした。')
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [accountId, searchQuery])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    accountGeneration.current += 1
    setNotice('')
    setStatus('pending')
    setView('list')
    setSearchInput('')
    setSearchQuery('')
    setSelectedPhotoIds([])
    setHistoryOpen(false)
  }, [accountId])

  const loadMore = useCallback(async () => {
    if (!accountId || loadingMore || !hasMorePhotos) return
    const sequence = loadSequence.current
    setLoadingMore(true)
    try {
      const response = await fetchApi<PhotoPageResponse>(photoPagePath(accountId, photos.length, searchQuery))
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error('load_failed')
      setPhotos((current) => [...current, ...response.data])
      setHasMorePhotos(response.data.length === PHOTO_PAGE_SIZE)
    } catch (error) {
      if (sequence === loadSequence.current) {
        setNotice(photoNoticeFor(error, '続きの写真を読み込めませんでした。'))
      }
    } finally {
      if (sequence === loadSequence.current) setLoadingMore(false)
    }
  }, [accountId, loadingMore, hasMorePhotos, photos.length, searchQuery])

  const counts = {
    pending: photos.filter((photo) => text(photo.status) === 'pending').length,
    adopted: photos.filter((photo) => text(photo.status) === 'adopted').length,
    rejected: photos.filter((photo) => text(photo.status) === 'rejected').length,
  }
  const visiblePhotos = photos.filter((photo) => text(photo.status) === status)
  const countsReady = Boolean(accountId) && !loading && !loadError
  const adoptedThisMonth = photos.filter((photo) => text(photo.status) === 'adopted' && isThisMonth(text(photo.reviewed_at))).length
  const rejectedThisMonth = photos.filter((photo) => text(photo.status) === 'rejected' && isThisMonth(text(photo.reviewed_at)))
  const reasonCounts = (() => {
    const tally = new Map<string, number>()
    for (const photo of rejectedThisMonth) {
      const code = text(photo.review_reason_code)
      if (!code) continue
      tally.set(code, (tally.get(code) ?? 0) + 1)
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])
  })()
  const topReason = reasonCounts[0]?.[0]
    ? REVIEW_REASONS.find((reason) => reason.value === reasonCounts[0][0])?.label ?? '理由未記録'
    : '—'

  const [publicationCandidate, setPublicationCandidate] = useState<{id: string; version: number; key: string} | null>(null)
  const preparePublication = async (id: string) => {
    if (!accountId || !canEdit || reviewing) return
    const generation = accountGeneration.current
    setReviewing(id)
    setNotice('')
    try {
      const detail = await api.nenMembers.photo(id, accountId)
      if (generation !== accountGeneration.current) return
      if (!detail.success) throw new Error(detail.error)
      setPublicationCandidate({ id, version: Number(detail.data.publication?.version ?? 0), key: crypto.randomUUID() })
    } catch (error) { if (generation === accountGeneration.current) setNotice(photoNoticeFor(error, '掲載状態を読み込めませんでした。')) }
    finally { if (generation === accountGeneration.current) setReviewing(null) }
  }
  const confirmPublication = async () => {
    if (!accountId || !publicationCandidate || reviewing) return
    const generation = accountGeneration.current
    setReviewing(publicationCandidate.id)
    setNotice('')
    try {
      const response = await api.nenMembers.publishPhoto(publicationCandidate.id, { accountId, expectedVersion: publicationCandidate.version }, publicationCandidate.key)
      if (generation !== accountGeneration.current) return
      if (!response.success) throw new Error(response.error)
      setPublicationCandidate(null)
      notifyToast('公式サイトへの掲載を保存しました。追加報酬の手続き状況は掲載一覧で確認できます。')
      await load()
    } catch (error) { if (generation === accountGeneration.current) setNotice(photoNoticeFor(error, '掲載できませんでした。掲載状態と同意を読み直してください。')) }
    finally { if (generation === accountGeneration.current) setReviewing(null) }
  }
  useEffect(() => { setPublicationCandidate(null) }, [accountId])

  const review = async (
    id: string,
    nextStatus: 'adopted' | 'rejected',
    rejection?: { reasonCode: ReviewReasonCode; reasonNote: string; resubmitInvite: boolean; watchSubmitter: boolean },
  ) => {
    if (!accountId || !canEdit) return
    const generation = accountGeneration.current
    const idempotencyKey = reviewKeys.current.get(id) ?? crypto.randomUUID()
    reviewKeys.current.set(id, idempotencyKey)
    setReviewing(id)
    try {
      const response = await api.nenMembers.reviewPhoto(id, {
        accountId,
        status: nextStatus,
        expectedVersion: reviewVersionOf(photos.find((photo) => text(photo.id) === id)),
        ...(rejection
          ? {
              reasonCode: rejection.reasonCode,
              reasonNote: rejection.reasonNote,
              resubmitInvite: rejection.resubmitInvite,
              watchSubmitter: rejection.watchSubmitter,
            }
          : {}),
      }, idempotencyKey)
      if (generation !== accountGeneration.current) return
      if (!response.success) throw new Error(response.error)
      reviewKeys.current.delete(id)
      setNotice('')
      notifyToast(nextStatus === 'adopted'
        ? '写真を採用しました。公開は本人の同意がある場合だけ行います。'
        : '見送り理由を保存しました。')
      setRejectingPhotoId(null)
      await load()
    } catch (error) {
      if (generation === accountGeneration.current) {
        setNotice(photoNoticeFor(error, '審査結果を保存できませんでした。'))
        if (error instanceof ApiError && error.status === 409) {
          reviewKeys.current.delete(id)
          await load()
        }
      }
    } finally { setReviewing(null) }
  }

  const [rejectingPhotoId, setRejectingPhotoId] = useState<string | null>(null)
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false)
  const [bulkReturnOpen, setBulkReturnOpen] = useState(false)
  const [bulkReviewing, setBulkReviewing] = useState(false)
  const [reasonCode, setReasonCode] = useState<ReviewReasonCode>('quality')
  const [reasonNote, setReasonNote] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [resubmitInvite, setResubmitInvite] = useState(true)
  const [watchSubmitter, setWatchSubmitter] = useState(false)

  const openRejectDialog = (id: string) => {
    setRejectingPhotoId(id)
    setReasonCode('quality')
    setReasonNote('')
    setReasonError('')
    setResubmitInvite(true)
    setWatchSubmitter(false)
  }

  const pendingPhotos = photos.filter((photo) => text(photo.status) === 'pending')
  const selectedPendingPhotos = pendingPhotos.filter((photo) => selectedPhotoIds.includes(text(photo.id)))
  const selectedPhotosAreLowRisk = selectedPendingPhotos.length > 0
    && selectedPendingPhotos.every((photo) => ['safe', 'none', 'low'].includes(text(photo.latest_risk_flag)))

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotoIds((current) => current.includes(id)
      ? current.filter((photoId) => photoId !== id)
      : [...current, id])
  }

  const bulkReview = async (
    decision: 'approve' | 'return',
    rejection?: { reasonCode: ReviewReasonCode; reasonNote: string },
  ) => {
    if (!accountId || selectedPendingPhotos.length === 0) return
    const generation = accountGeneration.current
    setBulkReviewing(true)
    try {
      const response = await api.nenMembers.bulkReviewPhotos({
        lineAccountId: accountId,
        decisions: selectedPendingPhotos.map((photo) => ({
          photoId: text(photo.id),
          decision,
          expectedVersion: reviewVersionOf(photo),
          reasonCode: rejection?.reasonCode ?? null,
          reasonNote: rejection?.reasonNote || null,
        })),
      }, crypto.randomUUID())
      if (generation !== accountGeneration.current) return
      if (!response.success) throw new Error(response.error)
      const data = response.data as Partial<PhotoBulkReviewResult>
      const count = typeof data.updatedCount === 'number' ? data.updatedCount : selectedPendingPhotos.length
      notifyToast(`${count}枚の審査結果を保存し、投稿者へLINEで通知しました。`)
      setSelectedPhotoIds([])
      setBulkApproveOpen(false)
      setBulkReturnOpen(false)
      setReasonCode('quality')
      setReasonNote('')
      setReasonError('')
      await load()
    } catch (error) {
      if (generation === accountGeneration.current) {
        setNotice(photoNoticeFor(error, 'まとめて審査できませんでした。'))
      }
    } finally {
      setBulkReviewing(false)
    }
  }

  const retryNotification = async (id: string) => {
    if (!accountId) return
    const generation = accountGeneration.current
    setReviewing(id)
    try {
      const response = await api.nenMembers.retryPhotoReviewNotification(id, accountId, crypto.randomUUID())
      if (generation !== accountGeneration.current) return
      if (!response.success) throw new Error(response.error)
      setNotice('審査結果を投稿者へLINEで再送しました。')
      await load()
    } catch (error) {
      if (generation === accountGeneration.current) {
        setNotice(error instanceof Error ? error.message : 'LINE通知を再送できませんでした。')
      }
    } finally {
      setReviewing(null)
    }
  }

  const changeTab = (next: PhotoStatus | 'publications') => {
    if (next === 'publications') {
      setView('publications')
      return
    }
    setView('list')
    setStatus(next)
    setSelectedPhotoIds([])
    setBulkApproveOpen(false)
    setBulkReturnOpen(false)
  }

  return (
    <div data-design-node={boardNode(view, status, canEdit)} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>投稿</h1>
          <p className={styles.headDesc}>お客さまが送ってくれたペットの写真を確かめて、公式サイトに載せるかを決めます。</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setHistoryOpen(true)}>版の履歴を見る</Button>
      </div>
      <div data-design-node="photo-tabs-v8">
        <Tabs
          items={[
            { label: '審査待ち', count: countsReady ? counts.pending : undefined, current: view === 'list' && status === 'pending', onClick: () => changeTab('pending') },
            { label: '採用', count: countsReady ? counts.adopted : undefined, current: view === 'list' && status === 'adopted', onClick: () => changeTab('adopted') },
            { label: '見送り', count: countsReady ? counts.rejected : undefined, current: view === 'list' && status === 'rejected', onClick: () => changeTab('rejected') },
            { label: '公式サイト掲載', current: view === 'publications', onClick: () => changeTab('publications') },
          ]}
        />
      </div>

      <ul className={styles.kpiBand} aria-label="投稿の数の帯">
        <KpiCellV8 label="審査待ち" help="まだ決めていない写真の枚数です" value={countsReady ? counts.pending : null} unit="枚" sub={reviewMetrics?.oldestPendingAt ? `いちばん古いもの ${formatPhotoReceivedAt(reviewMetrics.oldestPendingAt)}` : 'いちばん古いもの —'} />
        <KpiCellV8 label="今月採用" help="今月 採用した写真の枚数です" value={countsReady ? adoptedThisMonth : null} unit="枚" sub={policyPoints == null ? '1枚ごとに —' : `1枚ごとに ${formatNumber(policyPoints)}マイル`} />
        <KpiCellV8 label="今月見送り" help="今月 見送った写真の枚数です" value={countsReady ? rejectedThisMonth.length : null} unit="枚" sub={`理由：${topReason}`} />
        <KpiCellV8 label="公式サイト掲載" help="いま載っている写真の枚数です" value={publishedCount} unit="枚" sub="いま載っている写真" />
      </ul>

      {!accountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーから、写真審査を行うLINEアカウントを選びます。"
        />
      ) : view === 'publications' ? (
        <PublicationsV8
          accountId={accountId}
          canEdit={canEdit}
          publishedCount={publishedCount}
          onChanged={() => void load()}
        />
      ) : view === 'detail' ? (
        <DetailV8
          accountId={accountId}
          photos={visiblePhotos}
          onBack={() => setView('list')}
          onReload={() => void load()}
        />
      ) : (
        <ReviewListV8
          accountId={accountId}
          status={status}
          photos={visiblePhotos}
          loading={loading}
          loadError={loadError}
          loadForbidden={loadForbidden}
          canEdit={canEdit}
          reviewing={reviewing}
          notice={notice}
          searchInput={searchInput}
          searchQuery={searchQuery}
          hasMorePhotos={hasMorePhotos}
          loadingMore={loadingMore}
          policyPoints={policyPoints}
          reasonCounts={reasonCounts}
          selectedPhotoIds={selectedPhotoIds}
          selectedPendingCount={selectedPendingPhotos.length}
          selectedPhotosAreLowRisk={selectedPhotosAreLowRisk}
          bulkReviewing={bulkReviewing}
          onSearchInput={setSearchInput}
          onSearchQuery={(q) => { setSearchQuery(q); }}
          onToggleSelect={togglePhotoSelection}
          onApprove={(id) => void review(id, 'adopted')}
          onReject={openRejectDialog}
          onRetryNotification={(id) => void retryNotification(id)}
          onOpenDetail={() => setView('detail')}
          onPublish={(id) => void preparePublication(id)}
          onOpenPublications={() => setView('publications')}
          onLoadMore={() => void loadMore()}
          onRetryLoad={() => void load()}
          onBulkApprove={() => setBulkApproveOpen(true)}
          onBulkReturn={() => setBulkReturnOpen(true)}
        />
      )}

      {rejectingPhotoId ? (
        <RejectDialogV8
          photo={photos.find((photo) => text(photo.id) === rejectingPhotoId) ?? null}
          reasonCode={reasonCode}
          reasonNote={reasonNote}
          reasonError={reasonError}
          resubmitInvite={resubmitInvite}
          watchSubmitter={watchSubmitter}
          busy={reviewing !== null}
          onReasonCode={setReasonCode}
          onReasonNote={setReasonNote}
          onResubmitInvite={setResubmitInvite}
          onWatchSubmitter={setWatchSubmitter}
          onClose={() => { setRejectingPhotoId(null); setReasonError('') }}
          onConfirm={() => {
            if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
            void review(rejectingPhotoId, 'rejected', { reasonCode, reasonNote: reasonNote.trim(), resubmitInvite, watchSubmitter })
          }}
        />
      ) : null}

      <Dialog open={bulkApproveOpen} title={`${selectedPendingPhotos.length}枚をまとめて採用`} description="選択した写真の件数、マイル、公開範囲を確認してください。" busy={bulkReviewing} confirmLabel="まとめて採用" cancelLabel="審査へ戻る" onCancel={() => setBulkApproveOpen(false)} onConfirm={() => void bulkReview('approve')}>
        <dl>
          <div><dt>写真</dt><dd>{selectedPendingPhotos.length}枚</dd></div>
          <div><dt>付与するマイル</dt><dd>合計 {policyPoints == null ? '—' : `${selectedPendingPhotos.length * policyPoints}マイル`}</dd></div>
          <div><dt>公開範囲</dt><dd>公開しない</dd></div>
        </dl>
        <p>写真を採用しても自動公開しません。本人の公開同意を確認したあと、公式サイト掲載画面で公開先を選びます。</p>
      </Dialog>
      <Dialog open={bulkReturnOpen} title={`${selectedPendingPhotos.length}枚をまとめて見送り`} description="選んだ理由と補足は、選択した写真すべてに記録され、投稿者へLINEで届きます。" tone="destructive" busy={bulkReviewing} error={reasonError} confirmLabel="この理由でまとめて見送り" cancelLabel="審査へ戻る" onCancel={() => { setBulkReturnOpen(false); setReasonError('') }} onConfirm={() => {
        if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
        void bulkReview('return', { reasonCode, reasonNote: reasonNote.trim() })
      }}>
        <div role="radiogroup" aria-label="見送り理由">
          {REVIEW_REASONS.map((reason) => (
            <button key={reason.value} type="button" role="radio" aria-checked={reasonCode === reason.value} className={styles.pill} onClick={() => { setReasonCode(reason.value); setReasonError('') }}>
              <span aria-hidden="true" className={styles.pillDot} />
              {reason.label}
            </button>
          ))}
        </div>
        <label className={styles.fieldLabel}>
          投稿者に届く補足（直せます）
          <textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value.slice(0, 500)); setReasonError('') }} rows={3} placeholder={reasonCode === 'other' ? '理由を入力してください' : '必要な場合だけ入力します'} />
        </label>
      </Dialog>

      <Dialog open={Boolean(publicationCandidate)} title="公式サイトに掲載しますか？"
        description="公開の同意と採用状態を確認して、公開用画像を掲載します。追加報酬は初回掲載の版で写真ごとに一度だけ手続きします。"
        confirmLabel="公式サイトに掲載する" error={notice} busy={Boolean(reviewing)} onConfirm={() => void confirmPublication()}
        onCancel={() => { if (!reviewing) setPublicationCandidate(null) }} />
      <HistoryDrawerV8
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onChanged={() => void load()}
      />
    </div>
  )
}

function KpiCellV8({ label, help, value, unit, sub }: { label: string; help: string; value: number | null; unit: string; sub: string }) {
  return (
    <li className={styles.kpiCell}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{label}</span>
        <button type="button" className={styles.kpiHelp} title={help} aria-label={`${label}：${help}`}>…</button>
      </div>
      <p className={styles.kpiValue}>{value === null ? '—' : <>{formatNumber(value)}<span className={styles.kpiUnit}>{unit}</span></>}</p>
      <p className={styles.kpiSub}>{sub}</p>
    </li>
  )
}

type ReviewListV8Props = {
  accountId: string
  status: PhotoStatus
  photos: Array<Record<string, unknown>>
  loading: boolean
  loadError: string
  loadForbidden: boolean
  canEdit: boolean
  reviewing: string | null
  notice: string
  searchInput: string
  searchQuery: string
  hasMorePhotos: boolean
  loadingMore: boolean
  policyPoints: number | null
  reasonCounts: Array<[string, number]>
  selectedPhotoIds: string[]
  selectedPendingCount: number
  selectedPhotosAreLowRisk: boolean
  bulkReviewing: boolean
  onSearchInput: (next: string) => void
  onSearchQuery: (next: string) => void
  onToggleSelect: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onRetryNotification: (id: string) => void
  onOpenDetail: () => void
  onPublish: (id: string) => void
  onOpenPublications: () => void
  onLoadMore: () => void
  onRetryLoad: () => void
  onBulkApprove: () => void
  onBulkReturn: () => void
}

/**
 * 審査の札（TkA4D・Jn95h・cniyw・見送り）。カードの並び＋右に決まりの棚。
 * 採用の札（cniyw）は棚なしで横いっぱいに並べる。
 */
function ReviewListV8(props: ReviewListV8Props) {
  const { status, photos, loading, loadError, loadForbidden, canEdit, notice } = props
  const showRail = status === 'pending'
  return (
    <>
      {notice ? <Notice tone="danger" message={notice} /> : null}
      {!canEdit ? (
        <NoteBar tone="info">
          見るだけの権限です。採用・見送りはできません。並べて見る／1枚ずつ大きく見る・探すは使えます。
        </NoteBar>
      ) : null}
      <div className={styles.tools} data-design-node="photo-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => {
            event.preventDefault()
            props.onSearchQuery(props.searchInput.trim().slice(0, 100))
          }}
        >
          <SearchField
            aria-label="写真を探す"
            value={props.searchInput}
            onChange={props.onSearchInput}
            onClear={() => props.onSearchInput('')}
            placeholder="名前・ペット名・コメントで探す"
            maxLength={100}
          />
        </form>
        <span className={styles.toolsTail}>
          {status === 'adopted' ? (
            <p className={styles.toolsNote}>写真を採用しても自動公開しません。本人の公開同意を確認したあと、公式サイト掲載で公開先を選びます。</p>
          ) : (
            <>
              <Button variant="secondary" disabled title="並べて見るは一覧の表示形式の追加口を接続後に使えます">並べて見る</Button>
              <Button variant="secondary" disabled={photos.length === 0} onClick={props.onOpenDetail}>1枚ずつ大きく見る</Button>
            </>
          )}
        </span>
      </div>

      {props.searchQuery ? (
        <p className={styles.toolsNote}>「{props.searchQuery}」で絞り込んでいます</p>
      ) : null}

      {!props.accountId ? null : loading && photos.length === 0 ? (
        <ListState kind="loading" title="写真を読み込んでいます" />
      ) : loadForbidden ? (
        <ListState kind="forbidden" title="写真を見る権限がありません" description="管理者へ写真審査の閲覧権限を確認してください。" />
      ) : loadError ? (
        <ListState kind="error" title="写真を読み込めませんでした" description="通信状態を確認して、もう一度読み込んでください。" onRetry={props.onRetryLoad} />
      ) : photos.length === 0 ? (
        <ListState kind="empty" emptyPreset="readonly" title="この状態の写真はありません" description="別の状態を選ぶか、新しい写真が届くまでお待ちください。" />
      ) : (
        <div className={showRail ? styles.reviewGrid : undefined}>
          <ul className={styles.cards} data-design-node="photo-cards-v8">
            {photos.map((photo) => (
              <PhotoCardV8 key={text(photo.id)} photo={photo} {...props} />
            ))}
          </ul>
          {showRail ? (
            <div className={styles.rail} data-design="Right" data-design-node="photo-rail-v8">
              <section className={styles.railCard} aria-label="報酬の決まり">
                <h2 className={styles.railTitle}>報酬の決まり</h2>
                <p className={styles.railRow}>採用したら <strong>{props.policyPoints == null ? '—' : `${formatNumber(props.policyPoints)}マイル`}</strong></p>
                <p className={styles.railNote}>採用すると、投稿した人にLINEでお知らせします</p>
              </section>
              <section className={styles.railCard} aria-label="確認する順">
                <h2 className={styles.railTitle}>確認する順</h2>
                <p className={styles.railRow}>古いものから <strong>いまの順</strong></p>
                <p className={styles.railRow}>会員ランクが高い人を先に <strong>しない（新着順）</strong></p>
              </section>
              <section className={styles.railCard} aria-label="見送り理由の内訳">
                <h2 className={styles.railTitle}>見送り理由の内訳（今月）</h2>
                {props.reasonCounts.length === 0 ? (
                  <p className={styles.railNote}>今月に見送った写真はまだありません</p>
                ) : (
                  props.reasonCounts.map(([code, count]) => (
                    <p className={styles.railRow} key={code}>
                      {REVIEW_REASONS.find((reason) => reason.value === code)?.label ?? '理由未記録'}
                      <strong>{count}</strong>
                    </p>
                  ))
                )}
              </section>
            </div>
          ) : null}
        </div>
      )}

      {!loading && !loadError && props.hasMorePhotos ? (
        <div>
          <Button variant="secondary" disabled={props.loadingMore} onClick={props.onLoadMore} busy={props.loadingMore} busyLabel="読み込み中...">
            {`さらに読み込む（いま${photos.length}枚）`}
          </Button>
        </div>
      ) : null}

      {status === 'pending' && props.selectedPendingCount > 0 ? (
        <BulkBar count={props.selectedPendingCount} unit="枚" hint="審査待ちの写真だけをまとめて処理します">
          <Button
            variant="secondary"
            disabled={!props.selectedPhotosAreLowRisk || props.bulkReviewing || !canEdit}
            title={!props.selectedPhotosAreLowRisk ? 'まとめて採用できるのは、注意候補がない写真だけです' : !canEdit ? '見るだけの権限ではまとめて採用できません' : undefined}
            onClick={props.onBulkApprove}
            busy={props.bulkReviewing}
            busyLabel="処理中..."
          >
            まとめて採用
          </Button>
          <Button variant="secondary" disabled={props.bulkReviewing || !canEdit} title={!canEdit ? '見るだけの権限ではまとめて見送りできません' : undefined} onClick={props.onBulkReturn}>
            まとめて見送り
          </Button>
        </BulkBar>
      ) : null}
    </>
  )
}

function PhotoCardV8({ photo, status, ...props }: { photo: Record<string, unknown>; status: PhotoStatus } & ReviewListV8Props) {
  const photoId = text(photo.id)
  const name = photoPetDisplayName(photo.pet_name, { callName: photo.pet_call_name, gender: photo.pet_gender })
  const selected = props.selectedPhotoIds.includes(photoId)
  const imageSrc = safePhotoSrc(photo.image_url)
  const busy = props.reviewing === photoId
  const consented = Boolean(text(photo.publication_consent_at)) && !text(photo.publication_withdrawn_at)
  const notificationFailed = text(photo.review_notification_status) === 'failed'
  return (
    <li className={`${styles.card}${selected ? ` ${styles.cardSelected}` : ''}`}>
      <div className={styles.cardPhoto}>
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- お客様が投稿した写真
          <img src={imageSrc} alt={`${name}の投稿写真`} loading="lazy" />
        ) : (
          <div className={styles.cardPhotoEmpty}>画像を表示できません</div>
        )}
        {status === 'pending' && props.canEdit ? (
          <span className={styles.cardPick}>
            <Checkbox checked={selected} onCheckedChange={() => props.onToggleSelect(photoId)} aria-label={`${name}の写真を選ぶ`}>選ぶ</Checkbox>
          </span>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardNameRow}>
          <p className={styles.cardName}>{name}</p>
          <span className={styles.cardDate}>{formatPhotoReceivedAt(photo.created_at)}</span>
        </div>
        <p className={styles.cardOwner}>{text(photo.owner_name) || '名前未取得'}{text(photo.customer_id) ? `・EC-${text(photo.customer_id)}` : ''}</p>
        {text(photo.caption) ? <p className={styles.cardCaption} title={text(photo.caption)}>「{text(photo.caption)}」</p> : null}
        {status === 'adopted' ? (
          <div className={styles.cardChips}>
            <Chip tone="ok">採用</Chip>
            <span className={styles.cardOwner}>{mileStatusLabel(photo.point_sync_status)}</span>
          </div>
        ) : null}
        {status === 'adopted' ? (
          <div className={styles.cardChips}>
            {consented ? <Chip tone="ok">公開の同意あり</Chip> : <Chip tone="neutral">公開しない</Chip>}
          </div>
        ) : null}
        {status === 'rejected' && text(photo.review_reason_code) ? (
          <p className={styles.rejectReason}>
            見送った理由：{REVIEW_REASONS.find((reason) => reason.value === text(photo.review_reason_code))?.label ?? '理由未記録'}
            {text(photo.review_reason_note) ? `／${text(photo.review_reason_note)}` : ''}
          </p>
        ) : null}
        {status === 'pending' ? (
          <div className={styles.cardActions}>
            <Button variant="secondary" disabled={!props.canEdit || busy} title={!props.canEdit ? '見るだけの権限では見送りできません' : undefined} onClick={() => props.onReject(photoId)}>{'× 見送る'}</Button>
            <Button variant="secondary" disabled={!props.canEdit || busy} title={!props.canEdit ? '見るだけの権限では採用できません' : undefined} onClick={() => props.onApprove(photoId)} busy={busy} busyLabel="処理中...">{'✓ 採用する'}</Button>
          </div>
        ) : null}
        {status === 'adopted' ? (
          <div className={styles.cardActions}>
            {consented ? (
              <Button variant="secondary" disabled={!props.canEdit || busy} busy={busy} onClick={() => props.onPublish(photoId)}>公式サイトに出す</Button>
            ) : null}
            {notificationFailed ? (
              <Button variant="secondary" disabled={busy} onClick={() => props.onRetryNotification(photoId)} busy={busy} busyLabel="再送中...">LINE通知を再送</Button>
            ) : null}
          </div>
        ) : null}
        {status === 'rejected' && notificationFailed ? (
          <div className={styles.cardActionSingle}>
            <Button variant="secondary" disabled={busy} onClick={() => props.onRetryNotification(photoId)} busy={busy} busyLabel="再送中...">LINE通知を再送</Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * この写真を見送る（ujcar）。真ん中の小窓。
 * 理由をえらぶとお客様への文章が自動でつくられる。
 * 見送ってもマイルは減らない。
 */
function RejectDialogV8({
  photo,
  reasonCode,
  reasonNote,
  reasonError,
  resubmitInvite,
  watchSubmitter,
  busy,
  onReasonCode,
  onReasonNote,
  onResubmitInvite,
  onWatchSubmitter,
  onClose,
  onConfirm,
}: {
  photo: Record<string, unknown> | null
  reasonCode: ReviewReasonCode
  reasonNote: string
  reasonError: string
  resubmitInvite: boolean
  watchSubmitter: boolean
  busy: boolean
  onReasonCode: (next: ReviewReasonCode) => void
  onReasonNote: (next: string) => void
  onResubmitInvite: (next: boolean) => void
  onWatchSubmitter: (next: boolean) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const name = photo ? photoPetDisplayName(photo.pet_name, { callName: photo.pet_call_name, gender: photo.pet_gender }) : '写真'
  const selectedReason = REVIEW_REASONS.find((reason) => reason.value === reasonCode)
  const preview = photo
    ? `${name}の写真をありがとうございます。${reasonCode === 'other' ? reasonNote || 'お客様に送る文章を入力してください。' : selectedReason?.message ?? ''}${reasonNote && reasonCode !== 'other' ? `\n${reasonNote}` : ''}\nお手数をおかけします。`
    : ''
  const imageSrc = photo ? safePhotoSrc(photo.image_url) : null
  return (
    <div className={styles.dialogOverlay} data-design-node="ujcar">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="この写真を見送りますか？">
        <div className={styles.dialogHead}>
          <div>
            <h2 className={styles.dialogTitle}>この写真を見送りますか？</h2>
            <p className={styles.dialogDesc}>理由をえらぶと、お客様への文章が自動でつくられます。見送っても、この方のマイルは減りません。</p>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        {photo ? (
          <div className={styles.dialogPhoto}>
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- お客様が投稿した写真
              <img src={imageSrc} alt="" className={styles.dialogPhotoThumb} />
            ) : null}
            <div>
              <p className={styles.dialogPhotoName}>{name}</p>
              <p className={styles.dialogPhotoSub}>{text(photo.owner_name) || 'お名前は未取得'}{text(photo.customer_id) ? `・EC-${text(photo.customer_id)}` : ''}・{formatPhotoReceivedAt(photo.created_at)}{text(photo.caption) ? `「${text(photo.caption)}」` : ''}</p>
            </div>
          </div>
        ) : null}
        <fieldset className={styles.pillGroup}>
          <legend className={styles.fieldLabel}>見送った理由</legend>
          {REVIEW_REASONS.map((reason) => (
            <button key={reason.value} type="button" role="radio" aria-checked={reasonCode === reason.value} className={styles.pill} onClick={() => onReasonCode(reason.value)}>
              <span aria-hidden="true" className={styles.pillDot} />
              {reason.label}
            </button>
          ))}
        </fieldset>
        <label className={styles.fieldLabel}>
          お客様に届く補足（直せます）
          <TextField aria-label="お客様に届く補足" value={reasonNote} maxLength={500} placeholder={reasonCode === 'other' ? 'お客様に送る文章を書いてください' : '必要な場合だけ補足します'} onChange={(event) => onReasonNote(event.target.value)} />
        </label>
        <label className={styles.checkRow}>
          <Checkbox checked={resubmitInvite} onCheckedChange={onResubmitInvite}>もう一度 送ってもらえるようお願いする</Checkbox>
        </label>
        <label className={styles.checkRow}>
          <Checkbox checked={watchSubmitter} onCheckedChange={onWatchSubmitter}>この人の次の投稿は、必ず人が見る</Checkbox>
        </label>
        <div>
          <p className={styles.fieldLabel}>投稿者に届く内容</p>
          <p className={styles.previewBox}>{preview}</p>
        </div>
        {reasonError ? <p className={styles.errorText} role="alert">{reasonError}</p> : null}
        <div className={styles.dialogFoot}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy} busy={busy} busyLabel="送っています…">見送る</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * 版の履歴（N1br7）。報酬の決まりの版の一覧・比べる・予約を
 * v7 の窓（PhotoRewardPolicyDrawer）で開く。口は v7 と同じ。
 */
function HistoryDrawerV8({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [revision, setRevision] = useState(0)
  const [versions, setVersions] = useState<PhotoRewardPolicyVersion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    void api.nenMembers.photoRewardPolicyVersions().then((res) => {
      if (!active) return
      if (!res.success) throw new Error(res.error)
      setVersions(res.data)
    }).catch((caught) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : '報酬の決まりを読み込めませんでした')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [open, revision])

  return (
    <div data-design-node={open ? 'N1br7' : undefined}>
      <PhotoRewardPolicyDrawer
        open={open}
        versions={versions}
        loading={loading}
        error={error}
        showPublicationReward
        onReload={() => setRevision((value) => value+1)}
        onClose={onClose}
        onChanged={() => { setRevision((value) => value+1); onChanged() }}
      />
    </div>
  )
}

type PublicationItem = Record<string, unknown> & { placements?: Array<Record<string, unknown>> }

function placementLabels(item: PublicationItem): string {
  const placements = Array.isArray(item.placements) ? item.placements : []
  const active = placements.filter((p) => Number(p.active ?? 1) === 1)
  if (active.length === 0) return 'どこにも出していません'
  return active.map((p) => text(p.placement_label) || text(p.placement_type)).join('・')
}

function viewsText(value: unknown): string {
  return value == null ? '—' : `${formatNumber(Number(value))}`
}

/**
 * 公式サイト掲載（SyQA1）。列：写真・ペット・どこで使っているか・
 * この30日に見た・公開の同意・掲載先から外す。右に出すときの決めごと。
 * 「この30日に見た」の30日集計の口はまだ無いので、いまの表示回数をそのまま出す。
 */
function PublicationsV8({
  accountId,
  canEdit,
  onChanged,
}: {
  accountId: string
  canEdit: boolean
  publishedCount: number | null
  onChanged: () => void
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [items, setItems] = useState<PublicationItem[]>([])
  const [topPhotoId, setTopPhotoId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [orderItems, setOrderItems] = useState<PublicationItem[] | null>(null)
  const generation = useRef(0)
  useEffect(() => { generation.current++; setOrderItems(null); setBusyId(''); setNotice('') }, [accountId])

  const load = useCallback(async () => {
    const token = ++generation.current
    setState('loading')
    try {
      const response = await api.nenMembers.photoPublications(accountId)
      if (token !== generation.current) return
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setItems([])
        setTopPhotoId(null)
      } else {
        setItems(response.data.items ?? [])
        setTopPhotoId(response.data.summary.topPhoto ? text(response.data.summary.topPhoto.id) : null)
      }
      setState('ready')
    } catch (error) {
      if (token !== generation.current) return
      setItems([])
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const withdraw = async (item: PublicationItem) => {
    setBusyId(text(item.id))
    setNotice('')
    try {
      await api.nenMembers.withdrawPhotoPublication(text(item.id), {
        accountId, expectedVersion: Number(item.version),
      }, crypto.randomUUID())
      notifyToast('写真をすべての掲載先から外しました。審査と同意の履歴、付与済みのマイルは残ります。')
      await load()
      onChanged()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載状態を変更しました。最新の状態を読み直してください。'
        : '写真を掲載先から外せませんでした。')
    } finally { setBusyId('') }
  }

  const openOrder = async () => {
    if (!canEdit || busyId) return
    const token = generation.current
    setBusyId('order-load')
    try {
      const response = await api.nenMembers.photoPublicationOrder(accountId)
      if (token !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setOrderItems(response.data.items)
    } catch (error) { if (token === generation.current) setNotice(photoNoticeFor(error, '掲載順を読み込めませんでした。')) }
    finally { if (token === generation.current) setBusyId('') }
  }
  const moveOrder = (index: number, delta: number) => {
    setOrderItems((current) => {
      if (!current || index+delta < 0 || index+delta >= current.length) return current
      const copy = [...current]; [copy[index], copy[index+delta]] = [copy[index+delta], copy[index]]
      return copy
    })
  }
  const saveOrder = async () => {
    if (!orderItems || busyId) return
    const token = generation.current
    setBusyId('order')
    setNotice('')
    try {
      const response = await api.nenMembers.savePhotoPublicationOrder({ accountId, items: orderItems.map(item => ({ id: text(item.id), expectedVersion: Number(item.version) })) })
      if (token !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setOrderItems(null)
      setBusyId('')
      notifyToast('掲載順を保存しました。')
      await load()
      onChanged()
    } catch (error) {
      if (token === generation.current) setNotice(error instanceof ApiError && error.status === 409
        ? '掲載の集合か版が変わりました。キャンセルして最新の全件を読み直してください。'
        : '掲載順を保存できませんでした。')
    } finally { if (busyId === 'order' || token === generation.current) setBusyId('') }
  }

  return (
    <>
      <Dialog open={orderItems !== null} title="掲載順を変える" description="上から順に公式サイトへ表示します。全件と確認した版をまとめて保存します。"
        confirmLabel="並び順を保存する" error={notice} busy={busyId === 'order'} onConfirm={() => void saveOrder()}
        onCancel={() => { if (!busyId) { setOrderItems(null); void load() } }}>
        <ol>{orderItems?.map((item, index) => <li key={text(item.id)} className="flex items-center justify-between gap-2 py-2">
          <span className="truncate">{index+1}・{photoPetDisplayName(item.pet_name, { honorific: false })}</span>
          <span className="flex gap-2"><Button disabled={index === 0 || Boolean(busyId)} aria-label={`${text(item.pet_name)}を上へ`} onClick={() => moveOrder(index,-1)}>上へ</Button>
          <Button disabled={index === orderItems.length-1 || Boolean(busyId)} aria-label={`${text(item.pet_name)}を下へ`} onClick={() => moveOrder(index,1)}>下へ</Button></span>
        </li>)}</ol>
      </Dialog>
      {notice ? <Notice tone="danger" message={notice} /> : null}
      {state === 'loading' ? (
        <ListState kind="loading" title="公式サイト掲載中の写真を読み込んでいます" />
      ) : state === 'forbidden' ? (
        <ListState kind="forbidden" />
      ) : state === 'error' ? (
        <ListState kind="error" title="公式サイト掲載中の写真を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ListState kind="empty" emptyPreset="readonly" title="公式サイト掲載中の写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" />
      ) : (
        <div className={styles.reviewGrid}>
          <section data-design-node="photo-pubs-table-v8">
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th>写真</Th>
                    <Th>ペット</Th>
                    <Th>どこで使っているか</Th>
                    <Th align="right">この30日に見た</Th>
                    <Th>公開の同意</Th>
                    <Th align="right">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const imageSrc = safePhotoSrc(item.image_url)
                    const name = photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })
                    const consented = Boolean(text(item.publication_consent_at))
                    return (
                      <Tr key={text(item.id)}>
                        <Td>
                          {imageSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element -- 掲載中の公開写真
                            <img src={imageSrc} alt={`${name}の公開写真`} loading="lazy" className={styles.pubThumb} />
                          ) : (
                            <span aria-hidden="true" className={styles.pubThumb} />
                          )}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={styles.petNameV8}>{name}</span>
                            {topPhotoId === text(item.id) ? <Chip tone="info">いちばん見られた</Chip> : null}
                          </span>
                          <span className={styles.petSubV8}>{text(item.owner_name) || '名前は伏せています'}</span>
                        </Td>
                        <Td><span className="block truncate text-label text-ink-secondary" title={placementLabels(item)}>{placementLabels(item)}</span></Td>
                        <Td align="right"><span className="text-label tabular-nums text-ink">{viewsText(item.view_count)}</span>
                          {Number(item.publication_points) > 0 && <span className="block text-caption text-ink-secondary">掲載報酬 {Number(item.publication_points)}pt・{item.publication_point_sync_status === 'synced' ? '付与済み' : item.publication_point_sync_status === 'failed' ? '要対応' : '手続き中'}</span>}
                        </Td>
                        <Td>{consented ? <Chip tone="ok">同意あり</Chip> : <Chip tone="neutral">未取得</Chip>}</Td>
                        <Td align="right">
                          <Button
                            variant="secondary"
                            disabled={!canEdit || busyId === text(item.id)}
                            title={!canEdit ? '見るだけの権限では掲載先から外せません' : undefined}
                            onClick={() => void withdraw(item)}
                            busy={busyId === text(item.id)}
                            busyLabel="外しています..."
                          >
                            掲載先から外す
                          </Button>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </div>
            <p className={styles.listHintV8}>公式サイト掲載中 {items.length}枚を表示（使っている場所で絞る：サイト・NENコラム・リッチメニュー・回答フォーム・登録メディア）</p>
          </section>
          <div className={styles.rail} data-design="Right" data-design-node="photo-pubs-rail-v8">
            <section className={styles.railCard} aria-label="出すときの決めごと">
              <h2 className={styles.railTitle}>出すときの決めごと</h2>
              <ul className={styles.pubRules}>
                <li>投稿のときに公開への同意をいただいた写真だけを出します</li>
                <li>名前は写真ごとに伏せられます</li>
                <li>公開の期限は設けていません。外す操作をするまで掲載され続けます</li>
                <li>外しても採用時のマイルは戻りません</li>
                <li>原本は公開しません。選んだ場所へ公開用画像を出します</li>
              </ul>
              <Button variant="secondary" disabled={!canEdit || Boolean(busyId)} onClick={() => void openOrder()}>並び順を変える</Button>
            </section>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 1枚ずつ大きく見る。今の作りのまま v7 の詳細部品を使う
 * （V8 の板に無いため。向きの保存・マイルの手続き・原本の取り出しを含む）。
 */
function DetailV8({
  accountId,
  photos,
  onBack,
  onReload,
}: {
  accountId: string
  photos: Array<Record<string, unknown>>
  onBack: () => void
  onReload: () => void
}) {
  const [photoId, setPhotoId] = useState<string | null>(() => (photos.length > 0 ? text(photos[0].id) : null))
  const [detailPhoto, setDetailPhoto] = useState<Record<string, unknown> | null>(null)
  const [detailState, setDetailState] = useState<'ready' | 'empty' | 'error' | 'forbidden'>('empty')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAssetStatus, setDetailAssetStatus] = useState<import('@/lib/api').PhotoAssetStatus | null>(null)
  const [detailDerivatives, setDetailDerivatives] = useState<import('@/lib/api').PhotoDerivatives | null>(null)
  const [detailAssetsFailed, setDetailAssetsFailed] = useState(false)
  const [assetProcessing, setAssetProcessing] = useState(false)
  const [rotationSaving, setRotationSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [notice, setNotice] = useState('')
  const [pointActionBusy, setPointActionBusy] = useState<'retry' | 'reconcile' | null>(null)
  const sequenceRef = useRef(0)
  const reviewKeys = useRef(new Map<string, string>())
  const rotationKeys = useRef(new Map<string, string>())

  const position = photoId ? Math.max(0, photos.findIndex((photo) => text(photo.id) === photoId)) : 0

  const refreshDetailAssets = useCallback(async (id: string) => {
    const [statusResult, derivativesResult] = await Promise.allSettled([
      api.nenMembers.photoAssetStatus(id, accountId),
      api.nenMembers.photoDerivatives(id, accountId),
    ])
    const loaded = statusResult.status === 'fulfilled' && statusResult.value.success ? statusResult.value.data : null
    const derivatives = derivativesResult.status === 'fulfilled' && derivativesResult.value.success ? derivativesResult.value.data : null
    setDetailAssetStatus(loaded)
    setDetailDerivatives(derivatives)
    setDetailAssetsFailed(loaded === null || derivatives === null)
  }, [accountId])

  const openDetail = useCallback(async (id: string) => {
    const sequence = ++sequenceRef.current
    setPhotoId(id)
    setDetailPhoto(null)
    setDetailAssetStatus(null)
    setDetailDerivatives(null)
    setDetailAssetsFailed(false)
    setDetailLoading(true)
    try {
      const [response] = await Promise.all([
        api.nenMembers.photo(id, accountId),
        refreshDetailAssets(id),
      ])
      if (sequence !== sequenceRef.current) return
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setDetailState('empty')
        return
      }
      setDetailPhoto(response.data)
      setDetailState('ready')
    } catch (error) {
      if (sequence !== sequenceRef.current) return
      setDetailState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    } finally {
      if (sequence === sequenceRef.current) setDetailLoading(false)
    }
  }, [accountId, refreshDetailAssets])

  useEffect(() => {
    if (photoId) void openDetail(photoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回だけ開く
  }, [])

  const review = async (id: string, nextStatus: 'adopted' | 'rejected') => {
    const idempotencyKey = reviewKeys.current.get(id) ?? crypto.randomUUID()
    reviewKeys.current.set(id, idempotencyKey)
    setReviewing(true)
    try {
      const response = await api.nenMembers.reviewPhoto(id, {
        accountId,
        status: nextStatus,
        expectedVersion: reviewVersionOf(detailPhoto && text(detailPhoto.id) === id ? detailPhoto : photos.find((photo) => text(photo.id) === id)),
      }, idempotencyKey)
      if (!response.success) throw new Error(response.error)
      reviewKeys.current.delete(id)
      notifyToast(nextStatus === 'adopted' ? '写真を採用しました。公開は本人の同意がある場合だけ行います。' : '見送り理由を保存しました。')
      onReload()
      onBack()
    } catch (error) {
      setNotice(photoNoticeFor(error, '審査結果を保存できませんでした。'))
    } finally { setReviewing(false) }
  }

  const pointAction = async (action: 'retry' | 'reconcile') => {
    if (!detailPhoto) return
    const id = text(detailPhoto.id)
    setPointActionBusy(action)
    try {
      const response = action === 'retry'
        ? await api.nenMembers.photoPointRetry(id, accountId)
        : await api.nenMembers.photoPointReconcile(id, accountId)
      if (!response.success) {
        setNotice(response.error || 'マイルの手続きに失敗しました。通信を確かめて、もう一度お試しください。')
        return
      }
      setNotice(response.data.synced ? 'マイルを付けました。' : '手続きはまだ完了していません。')
      void openDetail(id)
    } catch {
      setNotice('マイルの手続きに失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setPointActionBusy(null)
    }
  }

  const saveRotation = async (rotation: 0 | 90 | 180 | 270) => {
    if (!detailPhoto) return
    const id = text(detailPhoto.id)
    const idempotencyKey = rotationKeys.current.get(id) ?? crypto.randomUUID()
    rotationKeys.current.set(id, idempotencyKey)
    setRotationSaving(true)
    try {
      const response = await api.nenMembers.savePhotoRotation(id, {
        accountId,
        rotation,
        expectedVersion: reviewVersionOf(detailPhoto),
      }, idempotencyKey)
      if (!response.success) throw new Error(response.error)
      rotationKeys.current.delete(id)
      setDetailPhoto((current) => current && text(current.id) === id
        ? { ...current, display_rotation: rotation, review_version: response.data.reviewVersion }
        : current)
      setNotice('写真の向きを保存しました。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '写真の向きを保存できませんでした。')
    } finally {
      setRotationSaving(false)
    }
  }

  const downloadOriginal = async (code: string) => {
    if (!detailPhoto) throw new Error('写真を読み直してください。')
    const grant = await api.nenMembers.photoOriginalStepUp({ method: 'totp', value: code })
    if (!grant.success) throw new Error(grant.error)
    const issued = await api.nenMembers.issuePhotoOriginalDownload(
      text(detailPhoto.id),
      { lineAccountId: accountId, expectedVersion: reviewVersionOf(detailPhoto) },
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

  const move = (direction: 1 | -1) => {
    const next = photos[position + direction]
    if (next) void openDetail(text(next.id))
  }

  const processReviewAsset = async () => {
    if (!detailPhoto) return
    const id = text(detailPhoto.id)
    setAssetProcessing(true)
    try {
      const response = await api.nenMembers.processPhotoAssets(id, {
        lineAccountId: accountId,
        expectedVersion: reviewVersionOf(detailPhoto),
        operation: 'review',
      }, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      notifyToast(response.data.status === 'completed'
        ? '審査用画像を作り直しました。'
        : '審査用画像の作り直しを受け付けました。')
      await refreshDetailAssets(id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '審査用画像を作り直せませんでした。')
    } finally {
      setAssetProcessing(false)
    }
  }

  return (
    <PhotoReviewDetail
      photo={detailPhoto}
      position={position}
      total={photos.length}
      loading={detailLoading}
      loadKind={detailState}
      reviewing={reviewing}
      notice={notice}
      accountNotice=""
      assetStatus={detailAssetStatus}
      derivatives={detailDerivatives}
      assetsFailed={detailAssetsFailed}
      onReloadAssets={() => { if (photoId) void refreshDetailAssets(photoId) }}
      assetProcessing={assetProcessing}
      rotationSaving={rotationSaving}
      onBack={onBack}
      onMove={move}
      onApprove={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted') }}
      onAdoptWithoutReward={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted') }}
      onReturn={onBack}
      onProcessReviewAsset={() => void processReviewAsset()}
      onSaveRotation={(rotation) => saveRotation(rotation)}
      onDownloadOriginal={downloadOriginal}
      onPointAction={pointAction}
      pointActionBusy={pointActionBusy}
    />
  )
}
