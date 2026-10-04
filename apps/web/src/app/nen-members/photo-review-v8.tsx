'use client'

/* Pencil の6枚のHTMLをもとにした投稿画面。既存の審査APIを接続する。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Globe, History, HelpCircle, Undo2, X, Check, Send } from 'lucide-react'
import type { ApiResponse } from '@line-crm/shared'
import { ApiError, api, fetchApi, type PhotoBulkReviewResult, type PhotoReviewMetrics } from '@/lib/api'
import Button from '@/components/shared/button'
import ActionMenu from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import BulkBar from '@/components/shared/bulk-bar'
import Checkbox from '@/components/shared/checkbox'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import SegmentedControl from '@/components/shared/segmented'
import { notifyToast } from '@/components/shared/toast'
import { Tabs } from '@/components/shared/tabs'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { formatNumber } from '@/lib/format'
import { photoPetDisplayName } from '@/components/shared/photo-display-name'
import { formatPhotoReceivedAt } from './photo-review-time'
import { safePhotoSrc } from './photo-src'
import { photoNoticeFor } from './photo-notice'
import { photoReviewEntryFrom, photoReviewSearch, type PhotoReviewEntry } from './photo-review-query'
import { formatMinutesRough, formatWaitRough } from '@/lib/format-duration'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import { mileStatusLabel, reviewVersionOf, text } from './photo-text'
import { PhotoReviewDetail } from './photo-review-detail'
import PhotoPolicyHistoryV8 from './photo-policy-history-v8'
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
// 送信文の理由名は Worker の photoReviewMessage と同じにする。
const SENT_REASON_LABELS: Record<ReviewReasonCode, string> = {
  quality: '写真が暗い・ぼやけている',
  privacy: '人の顔や個人情報が写っている',
  unrelated: 'ペットと関係のない内容が写っている',
  duplicate: '同じ写真がすでに投稿されている',
  other: 'そのほか',
}

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
  const month = (date: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).format(date)
  return month(new Date(time)) === month(new Date())
}

/**
 * 投稿の V8 画面。外枠（見出し・版の履歴・札・数の帯）は全部の札で同じ。
 */
export default function PhotoReviewV8({ accountId }: { accountId: string | null }) {
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [reviewMetrics, setReviewMetrics] = useState<PhotoReviewMetrics | null>(null)
  const [policyPoints, setPolicyPoints] = useState<number | null>(null)
  const [publishedCount, setPublishedCount] = useState<number | null>(null)
  const [entry, setEntry] = useState<PhotoReviewEntry>(() => photoReviewEntryFrom(typeof window === 'undefined' ? '' : window.location.search))
  const [status, setStatus] = useState<PhotoStatus>(entry.status)
  const [view, setView] = useState<PhotoView>(entry.view)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadForbidden, setLoadForbidden] = useState(false)
  const [hasMorePhotos, setHasMorePhotos] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState('')
  const [searchInput, setSearchInput] = useState(entry.q ?? '')
  const [searchQuery, setSearchQuery] = useState(entry.q ?? '')
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  // 審査・見送りの口は owner/admin だけ。staff は見るだけ（Jn95h）。
  const [canEdit, setCanEdit] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const loadSequence = useRef(0)
  const accountGeneration = useRef(0)
  const reviewKeys = useRef(new Map<string, string>())
  const retryKeys = useRef(new Map<string, string>())
  const [bulkFailed, setBulkFailed] = useState<Array<{ photoId: string; petName: string; error: string }>>([])

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
    if (policyResult.status === 'fulfilled' && policyResult.value.success && Array.isArray(policyResult.value.data)) {
      const current = policyResult.value.data.find((v) => v.status === 'in_use') ?? null
      setPolicyPoints(current ? current.points : null)
    } else {
      setPolicyPoints(null)
    }
    if (publicationsResult.status === 'fulfilled' && publicationsResult.value.success && !Array.isArray(publicationsResult.value.data)) {
      setPublishedCount(publicationsResult.value.data?.summary?.publishedCount ?? null)
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
    setNotice(''); setSelectedPhotoIds([]); setHistoryOpen(false)
    setRejectingPhotoId(null); setBulkApproveOpen(false); setBulkReturnOpen(false); setBulkFailed([])
    setReviewing(null); setLoadingMore(false)
    const next = photoReviewEntryFrom(window.location.search)
    setEntry(next); setStatus(next.status); setView(next.view)
    setSearchInput(next.q ?? ''); setSearchQuery(next.q ?? '')
    reviewKeys.current.clear(); retryKeys.current.clear()
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(`nen-photo-review:selection:${accountId}`) ?? '[]')
      setSelectedPhotoIds(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
    } catch { setSelectedPhotoIds([]) }
  }, [accountId])

  const selectionAccount = useRef(accountId)
  useEffect(() => {
    if (selectionAccount.current !== accountId) { selectionAccount.current = accountId; return }
    if (!accountId) return
    try { window.sessionStorage.setItem(`nen-photo-review:selection:${accountId}`, JSON.stringify(selectedPhotoIds)) } catch { /* 選択操作は続けられる。 */ }
  }, [accountId, selectedPhotoIds])
  useEffect(() => {
    const restore = () => {
      const next = photoReviewEntryFrom(window.location.search)
      setEntry(next); setStatus(next.status); setView(next.view)
      setSearchInput(next.q ?? ''); setSearchQuery(next.q ?? '')
    }
    window.addEventListener('popstate', restore)
    return () => { window.removeEventListener('popstate', restore); loadSequence.current += 1; accountGeneration.current += 1 }
  }, [])
  const navigate = (next: PhotoReviewEntry) => {
    window.history.pushState(null, '', `${window.location.pathname}?${photoReviewSearch(next)}`)
    setEntry(next); setStatus(next.status); setView(next.view)
  }

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
        expectedVersion: reviewVersionOf(photos.find((photo) => text(photo.id) === id) ?? (text(rejectingPhoto?.id) === id ? rejectingPhoto : null)),
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
      const notification = response.data.notificationStatus === 'sent'
        ? '投稿者へLINEで通知しました。'
        : '審査結果は保存しましたが、LINE通知は送れませんでした。一覧から再送できます。'
      /*
       * マイルの手続きは EC 会員とつながっている採用だけで始まる。
       * つながっていない採用に「手続きを始めました」と伝えるのは、
       * できていない約束をすることになる（#931 N-307）。
       */
      const adoptedNote = response.data.rewardSkipped === 'duplicate'
        ? '同じ写真はすでに報酬付きで採用されているため、点数は付けずに採用しました。'
        : response.data.rewardSkipped === 'requested'
          ? '報酬なしで採用しました。点数は付けていません。'
          : response.data.pointSync === 'pending'
            ? `ECへ${response.data.awardedPoints}マイルを付ける手続きを始めました。`
            : response.data.pointSync === 'needs_attention'
              ? 'EC会員とつながっていないため、マイルの手続きはまだ始まっていません。'
              : ''
      notifyToast(nextStatus === 'adopted'
        ? `写真を採用しました。${adoptedNote}公開は本人の同意がある場合だけ行います。${notification}`
        : `見送り理由を保存しました。${notification}`)
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
  const [rejectingPhoto, setRejectingPhoto] = useState<Record<string, unknown> | null>(null)
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
    setRejectingPhoto(photos.find((photo) => text(photo.id) === id) ?? null)
    if (accountId && !photos.some((photo) => text(photo.id) === id)) {
      const generation = accountGeneration.current
      void api.nenMembers.photo(id, accountId).then((response) => {
        if (generation === accountGeneration.current && response.success && !Array.isArray(response.data)) setRejectingPhoto(response.data)
      }).catch(() => undefined)
    }
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
      const names = new Map(selectedPendingPhotos.map((photo) => [text(photo.id), photoPetDisplayName(photo.pet_name, { callName: photo.pet_call_name, gender: photo.pet_gender })]))
      const failed = Array.isArray(data.notificationFailures) ? data.notificationFailures : []
      const failedPhotos = failed.map((item) => {
        const photoId = text((item as { photoId?: unknown })?.photoId)
        const error = text((item as { error?: unknown })?.error) || '通知できませんでした'
        return { photoId, petName: names.get(photoId) ?? '写真', error }
      }).filter((item) => item.photoId)
      setBulkFailed(failedPhotos)
      if (failedPhotos.length === 0) {
        notifyToast(`${count}枚の審査結果を保存し、投稿者へLINEで通知しました。`)
      } else {
        setNotice(`${count}枚の審査結果は保存済みです。${failedPhotos.length}枚のLINE通知は送れませんでした（通知だけ再送できます）。`)
      }
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
    if (!accountId || !canEdit) return
    const generation = accountGeneration.current
    const idempotencyKey = retryKeys.current.get(id) ?? crypto.randomUUID()
    retryKeys.current.set(id, idempotencyKey)
    setReviewing(id)
    try {
      const response = await api.nenMembers.retryPhotoReviewNotification(id, accountId, idempotencyKey)
      if (generation !== accountGeneration.current) return
      if (!response.success) throw new Error(response.error)
      retryKeys.current.delete(id)
      setBulkFailed((items) => items.filter((item) => item.photoId !== id))
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
      navigate({ view: 'publications', status })
      return
    }
    navigate({ view: 'list', status: next, q: searchQuery || undefined })
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
        <Button type="button" variant="secondary" onClick={() => setHistoryOpen(true)}><History size={15} aria-hidden="true" />版の履歴を見る</Button>
      </div>
      <div data-design-node="photo-tabs-v8">
        <Tabs
          items={[
            { label: hasMorePhotos && countsReady ? `審査待ち ${counts.pending}+` : '審査待ち', count: countsReady && !hasMorePhotos ? counts.pending : undefined, current: view === 'list' && status === 'pending', onClick: () => changeTab('pending') },
            { label: hasMorePhotos && countsReady ? `採用 ${counts.adopted}+` : '採用', count: countsReady && !hasMorePhotos ? counts.adopted : undefined, current: view === 'list' && status === 'adopted', onClick: () => changeTab('adopted') },
            { label: hasMorePhotos && countsReady ? `見送り ${counts.rejected}+` : '見送り', count: countsReady && !hasMorePhotos ? counts.rejected : undefined, current: view === 'list' && status === 'rejected', onClick: () => changeTab('rejected') },
            { label: '公式サイト掲載', current: view === 'publications', onClick: () => changeTab('publications') },
          ]}
        />
      </div>

      {!canEdit ? <div className={styles.readonly}><NoteBar tone="info">閲覧のみで見ています。変える操作は管理者に頼んでください。</NoteBar></div> : null}
      <ul data-design="KPIs" className={styles.kpiBand} aria-label="投稿の数の帯">
        <KpiCellV8 icon="pending" label="審査待ち" help={`まだ決めていない写真の枚数です。注意候補 ${reviewMetrics?.attentionCount ?? '—'}件・投稿から審査までの日数：${reviewMetrics?.averageReviewMinutes == null ? '—' : formatMinutesRough(reviewMetrics.averageReviewMinutes)}`} value={countsReady ? reviewMetrics?.pendingCount ?? counts.pending : null} unit="枚" sub={reviewMetrics?.oldestPendingAt ? `いちばん古いもの ${formatWaitRough((Date.now() - Date.parse(reviewMetrics.oldestPendingAt)) / 60000)}` : 'いちばん古いもの —'} />
        <KpiCellV8 icon="help" label="今月採用" help={hasMorePhotos ? '読み込んだ写真の集計です。続きの写真は含みません' : '今月 採用した写真の枚数です'} value={countsReady ? adoptedThisMonth : null} unit={hasMorePhotos ? '枚以上' : '枚'} sub={policyPoints == null ? '1枚ごとに —' : `1枚ごとに ${formatNumber(policyPoints)}マイル`} />
        <KpiCellV8 icon="help" label="今月見送り" help={hasMorePhotos ? '読み込んだ写真の集計です。理由の内訳も続きの写真は含みません' : '今月 見送った写真の枚数です'} value={countsReady ? rejectedThisMonth.length : null} unit={hasMorePhotos ? '枚以上' : '枚'} sub={`理由：${topReason}`} />
        <KpiCellV8 icon="published" label="公式サイト掲載" help="いま載っている写真の枚数です" value={publishedCount} unit="枚" sub="いま載っている写真" />
      </ul>

      {bulkFailed.length > 0 ? <section className={styles.deliveryFailures} aria-label="LINE通知を送れなかった写真"><p>LINE通知を送れなかった写真（{bulkFailed.length}枚）・通知だけ再送できます</p>{bulkFailed.map((item) => <div key={item.photoId}><span>{item.petName}</span><Button variant="secondary" disabled={!canEdit || reviewing !== null} onClick={() => void retryNotification(item.photoId)}>LINE通知を再送</Button></div>)}</section> : null}
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
          key={accountId}
          accountId={accountId}
          initialPhotoId={entry.photoId}
          canEdit={canEdit}
          onPhotoChange={(photoId) => navigate({ view: 'detail', status, photoId, q: searchQuery || undefined })}
          onReject={(id) => { setView('list'); openRejectDialog(id) }}
          photos={visiblePhotos}
          onBack={() => navigate({ view: 'list', status, q: searchQuery || undefined })}
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
          onSearchQuery={(q) => { setSearchQuery(q); navigate({ view: 'list', status, q: q || undefined }); }}
          onToggleSelect={togglePhotoSelection}
          onApprove={(id) => void review(id, 'adopted')}
          onReject={openRejectDialog}
          onRetryNotification={(id) => void retryNotification(id)}
          onOpenDetail={() => navigate({ view: 'detail', status, photoId: text(visiblePhotos[0]?.id), q: searchQuery || undefined })}
          onOpenPublications={() => navigate({ view: 'publications', status })}
          onLoadMore={() => void loadMore()}
          onRetryLoad={() => void load()}
          onBulkApprove={() => setBulkApproveOpen(true)}
          onBulkReturn={() => setBulkReturnOpen(true)}
        />
      )}

      {rejectingPhotoId ? (
        <RejectDialogV8
          photo={rejectingPhoto}
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

      <PhotoPolicyHistoryV8 canEdit={canEdit}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onChanged={() => void load()}
      />
    </div>
  )
}

function KpiCellV8({ icon, label, help, value, unit, sub }: { icon: 'pending' | 'help' | 'published'; label: string; help: string; value: number | null; unit: string; sub: string }) {
  return (
    <li className={styles.kpiCell}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIcon} aria-hidden="true">{icon === 'pending' ? <History size={13} /> : icon === 'published' ? <Undo2 size={13} /> : <HelpCircle size={13} />}</span><span className={styles.kpiLabel}>{label}</span>
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
        <div className={`${showRail ? styles.reviewGrid : styles.adoptedGrid} ${status === 'adopted' ? styles.adopted : ''}`}>
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
            placeholder={status === 'pending' ? '飼い主・ペット名で探す' : '名前・ペット名・コメントで探す'}
            maxLength={100}
          />
        </form>
        <span className={styles.toolsTail}>
          {status === 'adopted' ? (
            <p className={styles.toolsNote}>写真を採用しても自動公開しません。本人の公開同意を確認したあと、公式サイト掲載で公開先を選びます。</p>
          ) : (
            <>
              <SegmentedControl aria-label="写真の見え方" options={[{ value: 'list', label: '並べて見る' }, { value: 'detail', label: '1枚ずつ大きく見る' }]} value="list" onChange={(next) => { if (next === 'detail' && photos.length > 0) props.onOpenDetail() }} />
            </>
          )}
        </span>
      </div>

          <div className={styles.cardColumn}><ul className={styles.cards} data-design-node="photo-cards-v8">
            {photos.map((photo) => (
              <PhotoCardV8 key={text(photo.id)} photo={photo} {...props} />
            ))}
          </ul>{status === 'pending' ? <p className={styles.listHintV8}>「1枚ずつ大きく見る」にすると、写真を大きくして順に確かめられます（← → で次へ）</p> : null}</div>
          {showRail ? (
            <div className={styles.rail} data-design="Right" data-design-node="photo-rail-v8">
              <section className={styles.railCard} aria-label="報酬の決まり">
                <h2 className={styles.railTitle}>報酬の決まり</h2>
                <p className={styles.railRow}>採用したら <strong>{props.policyPoints == null ? '—' : `${formatNumber(props.policyPoints)}マイル`}</strong></p>
                <p className={styles.railRow}>公式サイトに載ったら <strong title="掲載時の追加報酬は未接続です">—</strong></p><p className={styles.railNote}>採用すると、投稿した人にLINEでお知らせします</p>
              </section>
              <section className={styles.railCard} aria-label="確認する順">
                <h2 className={styles.railTitle}>確認する順</h2>
                <p className={styles.railRow}>古いものから <strong>いまの順</strong></p>
                <p className={styles.railRow}>会員ランクが高い人を先に <strong>しない</strong></p>
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
            variant="primary"
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
    <li><article aria-label={`${name}の投稿写真`} className={`${styles.card}${selected ? ` ${styles.cardSelected}` : ''}`}>
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
          <p className={styles.cardName} title={name}>{name}</p>
          <span className={styles.cardDate} title={formatPhotoReceivedAt(photo.created_at)}>{Number.isFinite(Date.parse(text(photo.created_at))) ? new Date(text(photo.created_at)).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }) : '日時不明'}</span>
        </div>
        <p className={styles.cardOwner} title={`${text(photo.owner_name)} ${text(photo.customer_id)}`}>{text(photo.owner_name) || '名前未取得'}{text(photo.customer_id) ? `・EC-${text(photo.customer_id)}` : ''}</p>
        {text(photo.caption) ? <p className={styles.cardCaption} title={text(photo.caption)}>「{text(photo.caption)}」</p> : null}
        {status === 'adopted' ? (
          <div className={styles.cardChips}>
            <Chip tone="ok">採用</Chip>
            <span className={styles.cardOwner}>{Number.isFinite(Number(photo.awarded_points)) && photo.awarded_points != null && text(photo.point_sync_status) === 'synced' ? `${formatNumber(Number(photo.awarded_points))} マイル付与済み` : mileStatusLabel(photo.point_sync_status)}</span>
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
            <Button variant="secondary" disabled={!props.canEdit || busy} aria-label={`${name}の写真を見送る`} title={!props.canEdit ? '見るだけの権限では見送りできません' : undefined} onClick={() => props.onReject(photoId)}><X size={15} aria-hidden="true" />見送る</Button>
            <Button variant="secondary" disabled={!props.canEdit || busy} aria-label={`${name}の写真を採用する`} title={!props.canEdit ? '見るだけの権限では採用できません' : undefined} onClick={() => props.onApprove(photoId)} busy={busy} busyLabel="処理中..."><Check size={15} aria-hidden="true" />採用する</Button>
          </div>
        ) : null}
        {status === 'adopted' ? (
          <div className={styles.cardActions}>
            {consented ? (
              <Button variant="secondary" disabled={!props.canEdit} onClick={() => props.onOpenPublications()}><Globe size={15} aria-hidden="true" />公式サイトに出す</Button>
            ) : null}
            {notificationFailed ? (
              <Button variant="secondary" disabled={busy} onClick={() => props.onRetryNotification(photoId)} busy={busy} busyLabel="再送中..."><Send size={15} aria-hidden="true" />LINE通知を再送</Button>
            ) : null}
          </div>
        ) : null}
        {status !== 'adopted' && notificationFailed ? (
          <div className={styles.cardActionSingle}>
            <Button variant="secondary" disabled={busy} onClick={() => props.onRetryNotification(photoId)} busy={busy} busyLabel="再送中..."><Send size={15} aria-hidden="true" />LINE通知を再送</Button>
          </div>
        ) : null}
      </div>
    </article></li>
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
  const preview = photo
    ? [
      'お写真をご投稿いただきありがとうございます。',
      `今回は「${SENT_REASON_LABELS[reasonCode]}」のため、掲載を見送らせていただきました。`,
      ...(reasonNote.trim() ? [reasonNote.trim()] : []),
      ...(resubmitInvite ? ['内容をご確認のうえ、よろしければ別のお写真をご投稿ください。'] : []),
    ].join('\n')
    : ''
  const imageSrc = photo ? safePhotoSrc(photo.image_url) : null
  return (
    <Dialog open designNode="ujcar" title="この写真を見送りますか？" description="理由をえらぶと、お客様への文章が自動でつくられます。見送っても、この方のマイルは減りません。" confirmation tone="destructive" busy={busy} error={reasonError} onCancel={onClose} onConfirm={onConfirm} confirmLabel="見送る">
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
        <fieldset className={styles.pillGroup} role="radiogroup" aria-label="見送り理由">
          <legend className={styles.fieldLabel}>見送った理由</legend>
          {REVIEW_REASONS.map((reason) => (
            <button key={reason.value} type="button" role="radio" aria-checked={reasonCode === reason.value} className={styles.pill} onClick={() => { onReasonCode(reason.value); onReasonNote(reason.value === 'other' ? '' : reason.message) }}>
              <span aria-hidden="true" className={styles.pillDot} />
              {reason.label}
            </button>
          ))}
        </fieldset>
        <label className={styles.fieldLabel}>
          お客様に届く補足（直せます）
          <textarea aria-label="お客様に届く補足" className={styles.reasonTextarea} value={reasonNote} maxLength={500} rows={2} placeholder={reasonCode === 'other' ? 'お客様に送る文章を書いてください' : '必要な場合だけ補足します'} onChange={(event) => onReasonNote(event.target.value)} />
        </label>
        <label className={styles.checkRow}>
          <Checkbox checked={resubmitInvite} onCheckedChange={onResubmitInvite}>もう一度 送ってもらえるようお願いする</Checkbox>
        </label>
        <details className={styles.followup}><summary>次の投稿の確認方法</summary><Checkbox checked={watchSubmitter} onCheckedChange={onWatchSubmitter}>この人の次の投稿は、必ず人が見る</Checkbox></details>
        <div>
          <p className={styles.fieldLabel}>投稿者に届く内容</p>
          <div className={styles.previewBox}><p>{preview}</p></div>
        </div>
    </Dialog>
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
 * 30日集計は未接続なので「—」。掲載先の編集・撤回の整理・外した履歴を保つ。
 */
function PublicationsV8({
  accountId,
  canEdit,
  publishedCount,
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
  const [pendingWithdrawals, setPendingWithdrawals] = useState<PublicationItem[]>([])
  const [withdrawnItems, setWithdrawnItems] = useState<PublicationItem[]>([])
  const [editing, setEditing] = useState<PublicationItem | null>(null)
  const [selectedPlacements, setSelectedPlacements] = useState<string[]>([])
  const [menuId, setMenuId] = useState<string | null>(null)
  const generation = useRef(0)
  const loadSequence = useRef(0)
  const placementChoices = [{ type: 'site', label: 'サイト' }, { type: 'column', label: 'NENコラム' }, { type: 'rich_menu', label: 'リッチメニュー' }, { type: 'form', label: '回答フォーム' }] as const
  const openPlacements = (item: PublicationItem) => {
    setEditing(item); setNotice(''); setMenuId(null)
    setSelectedPlacements((item.placements ?? []).filter((placement) => Number(placement.active ?? 1) === 1).map((placement) => text(placement.placement_type)))
  }
  const savePlacements = async () => {
    if (!editing || !canEdit || busyId) return
    const accountGeneration = generation.current
    setBusyId(text(editing.id)); setNotice('')
    try {
      const response = await api.nenMembers.updatePhotoPublicationPlacements(text(editing.id), {
        accountId, expectedVersion: Number(editing.version), placements: placementChoices.filter((choice) => selectedPlacements.includes(choice.type)),
      }, crypto.randomUUID())
      if (accountGeneration !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setEditing(null); await load(); onChanged()
    } catch { if (accountGeneration === generation.current) setNotice('使う場所を保存できませんでした。最新の状態を読み直してください。') }
    finally { if (accountGeneration === generation.current) setBusyId('') }
  }


  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setState('loading')
    try {
      const response = await api.nenMembers.photoPublications(accountId)
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setItems([])
        setTopPhotoId(null)
      } else {
        setItems(response.data.items ?? [])
        setPendingWithdrawals(response.data.pendingWithdrawals ?? [])
        setWithdrawnItems(response.data.withdrawnItems ?? [])
        setTopPhotoId(response.data.summary.topPhoto ? text(response.data.summary.topPhoto.id) : null)
      }
      setState('ready')
    } catch (error) {
      setItems([])
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load(); return () => { generation.current += 1; loadSequence.current += 1 } }, [load])

  const withdraw = async (item: PublicationItem) => {
    if (!canEdit || busyId) return
    const accountGeneration = generation.current
    setBusyId(text(item.id))
    setNotice('')
    try {
      const response = await api.nenMembers.withdrawPhotoPublication(text(item.id), {
        accountId, expectedVersion: Number(item.version),
      }, crypto.randomUUID())
      if (accountGeneration !== generation.current) return
      if (!response.success) throw new Error(response.error)
      notifyToast('写真をすべての掲載先から外しました。審査と同意の履歴、付与済みのマイルは残ります。')
      await load()
      onChanged()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載状態を変更しました。最新の状態を読み直してください。'
        : '写真を掲載先から外せませんでした。')
    } finally { setBusyId('') }
  }

  return (
    <>
      {notice ? <Notice tone="danger" message={notice} /> : null}
      {state === 'loading' ? (
        <ListState kind="loading" title="公式サイト掲載中の写真を読み込んでいます" />
      ) : state === 'forbidden' ? (
        <ListState kind="forbidden" />
      ) : state === 'error' ? (
        <ListState kind="error" title="公式サイト掲載中の写真を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 && pendingWithdrawals.length === 0 && withdrawnItems.length === 0 ? (
        <ListState kind="empty" emptyPreset="readonly" title="公式サイト掲載中の写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" />
      ) : (
        <div className={styles.publicationsGrid}>
          <section data-design-node="photo-pubs-table-v8">
            <div className={styles.tableWrap}>
              <DataTable className={styles.publicationsTable}>
                <thead>
                  <TableHeadRow>
                    <Th>写真</Th>
                    <Th>ペット</Th>
                    <Th>どこで使っているか</Th>
                    <Th align="right"><span title="30日間の集計は未接続です。累計の回数には置き換えません">この30日に見た</span></Th>
                    <Th>公開の同意</Th>
                    <Th align="right">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const imageSrc = safePhotoSrc(item.image_url)
                    const name = photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })
                    const consented = Boolean(text(item.publication_consent_at)) && !text(item.publication_withdrawn_at)
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
                          <span className={styles.petSubV8}>{Number(item.hide_owner_name) === 0 ? '名前を出しています' : '名前は伏せています'}</span>
                        </Td>
                        <Td><span className="block truncate text-label text-ink-secondary" title={placementLabels(item)}>{placementLabels(item)}</span></Td>
                        <Td align="right"><span className="text-label tabular-nums text-ink">{viewsText(item.view_count_30d)}</span></Td>
                        <Td>{consented ? <Chip tone="ok">同意あり</Chip> : <Chip tone="neutral">未取得</Chip>}</Td>
                        <Td align="right">
                          <div className={styles.publicationActions}><Button
                            variant="secondary"
                            disabled={!canEdit || busyId === text(item.id)}
                            title={!canEdit ? '見るだけの権限では掲載先から外せません' : undefined}
                            onClick={() => void withdraw(item)}
                            busy={busyId === text(item.id)}
                            busyLabel="外しています..."
                          >
                            掲載先から外す
                          </Button><MoreAction aria-label={`${name}の掲載操作`} onClick={() => setMenuId(menuId === text(item.id) ? null : text(item.id))} /><ActionMenu open={menuId === text(item.id)} onClose={() => setMenuId(null)} items={[{ id: 'placements', label: '使う場所', disabled: !canEdit, disabledReason: !canEdit ? '閲覧のみの権限です' : undefined, onSelect: () => openPlacements(item) }]} /></div>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </div>
            <p className={styles.listHintV8}>公式サイト掲載中 {publishedCount ?? '—'}枚のうち {items.length}枚を表示（使っている場所で絞る：サイト・NENコラム・リッチメニュー・回答フォーム・登録メディア）</p>
            <details className={styles.publicationHistory}><summary>掲載の整理と外した履歴（{pendingWithdrawals.length + withdrawnItems.length}件）</summary>
              {pendingWithdrawals.map((item) => <div key={text(item.id)}><strong>{text(item.pet_name) || '写真'}</strong><p>{text(item.publication_withdrawn_at) ? 'ご本人が公開の同意を撤回しました' : '公開の同意と採用状態を確認してください'}</p><p>まだ残っている掲載先：{placementLabels(item)}</p><Button variant="secondary" disabled={!canEdit || Boolean(busyId)} onClick={() => void withdraw(item)}>掲載先から外す</Button></div>)}
              {withdrawnItems.map((item) => <div key={text(item.id)}><strong>{text(item.pet_name) || '写真'}</strong><p>外した日時：{formatPhotoReceivedAt(item.withdrawn_at)}・{text(item.withdrawn_by_name) || '—'}</p>{(item.placements ?? []).map((placement) => <p key={text(placement.id)}>{text(placement.placement_label)}・{text(placement.removed_at) ? `${formatPhotoReceivedAt(placement.removed_at)}に外しました` : '記録あり'}</p>)}</div>)}
            </details>
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
              <Button variant="secondary" disabled title="掲載順を保存するAPIは未接続です">並び順を変える</Button>
            </section>
          </div>
        </div>
      )}
      <Dialog open={Boolean(editing)} title="使う場所" description="同意のある写真の掲載先を選びます。原本は公開しません。" busy={Boolean(busyId)} error={notice} confirmLabel="保存する" onCancel={() => { if (!busyId) setEditing(null) }} onConfirm={() => void savePlacements()}>
        {placementChoices.map((choice) => <Checkbox key={choice.type} checked={selectedPlacements.includes(choice.type)} onCheckedChange={(checked) => setSelectedPlacements((current) => checked ? [...current, choice.type] : current.filter((type) => type !== choice.type))}>{choice.label}</Checkbox>)}
      </Dialog>
    </>
  )
}

/**
 * 1枚ずつ大きく見る。審査の詳細部品を使う
 * （V8 の板に無いため。向きの保存・マイルの手続き・原本の取り出しを含む）。
 */
function DetailV8({
  accountId,
  photos,
  initialPhotoId,
  canEdit,
  onPhotoChange,
  onReject,
  onBack,
  onReload,
}: {
  accountId: string
  initialPhotoId?: string
  canEdit: boolean
  onPhotoChange: (id: string) => void
  onReject: (id: string) => void
  photos: Array<Record<string, unknown>>
  onBack: () => void
  onReload: () => void
}) {
  const [photoId, setPhotoId] = useState<string | null>(() => initialPhotoId ?? (photos.length > 0 ? text(photos[0].id) : null))
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
    const sequence = sequenceRef.current
    const [statusResult, derivativesResult] = await Promise.allSettled([
      api.nenMembers.photoAssetStatus(id, accountId),
      api.nenMembers.photoDerivatives(id, accountId),
    ])
    if (sequence !== sequenceRef.current) return
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
    return () => { sequenceRef.current += 1 }
  }, [photoId, openDetail])
  useEffect(() => { if (initialPhotoId) setPhotoId(initialPhotoId) }, [initialPhotoId])

  const review = async (id: string, nextStatus: 'adopted' | 'rejected', withoutReward = false) => {
    if (!canEdit) return
    const idempotencyKey = reviewKeys.current.get(id) ?? crypto.randomUUID()
    reviewKeys.current.set(id, idempotencyKey)
    setReviewing(true)
    try {
      const response = await api.nenMembers.reviewPhoto(id, {
        accountId,
        status: nextStatus,
        ...(withoutReward ? { withoutReward: true } : {}),
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
    if (!detailPhoto || !canEdit) return
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
      setNotice(response.data.synced ? (response.data.duplicate ? 'EC側ではすでに付与済みでした。' : 'マイルを付けました。') : '手続きはまだ完了していません。')
      void openDetail(id)
    } catch {
      setNotice('マイルの手続きに失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setPointActionBusy(null)
    }
  }

  const saveRotation = async (rotation: 0 | 90 | 180 | 270) => {
    if (!detailPhoto || !canEdit) return
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
    const method = readSessionSnapshot()?.stepUpMethod ?? 'totp'
    if (method === 'none') throw new Error('原本の保存には再認証が必要です。管理者にご相談ください。')
    let grant
    try { grant = await api.nenMembers.photoOriginalStepUp({ method, value: code }) }
    catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) throw new Error('再認証コードを確認してください。')
      throw error
    }
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
    if (next) { onPhotoChange(text(next.id)); setPhotoId(text(next.id)) }
  }

  const processReviewAsset = async () => {
    if (!detailPhoto || !canEdit) return
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
      canEdit={canEdit}
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
      onAdoptWithoutReward={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted', true) }}
      onReturn={() => { if (detailPhoto && canEdit) onReject(text(detailPhoto.id)) }}
      onProcessReviewAsset={() => void processReviewAsset()}
      onSaveRotation={(rotation) => saveRotation(rotation)}
      onDownloadOriginal={downloadOriginal}
      onPointAction={pointAction}
      pointActionBusy={pointActionBusy}
    />
  )
}
