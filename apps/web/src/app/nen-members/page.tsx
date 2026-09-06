'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '@/lib/api'
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
const REVIEW_REASONS: Array<{ value: ReviewReasonCode; label: string }> = [
  { value: 'quality', label: '写真が暗い・ぼやけている' },
  { value: 'privacy', label: '人の顔や個人情報が写っている' },
  { value: 'unrelated', label: 'ペットと関係のない内容が写っている' },
  { value: 'duplicate', label: '同じ写真がすでに投稿されている' },
  { value: 'other', label: 'そのほか' },
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
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [view, setView] = useState<'list' | 'detail' | 'publications'>('list')
  const [detailPhoto, setDetailPhoto] = useState<Record<string, unknown> | null>(null)
  const [detailState, setDetailState] = useState<'ready' | 'empty' | 'error' | 'forbidden'>('empty')
  const [detailLoading, setDetailLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadForbidden, setLoadForbidden] = useState(false)
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [rejectingPhotoId, setRejectingPhotoId] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState<ReviewReasonCode>('quality')
  const [reasonNote, setReasonNote] = useState('')
  const [reasonError, setReasonError] = useState('')
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    if (!selectedAccountId) {
      setPhotos([])
      setLoadError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    setLoadForbidden(false)
    try {
      const response = await api.nenMembers.photos(selectedAccountId)
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
    setReasonCode('quality')
    setReasonNote('')
    setReasonError('')
    setView('list')
    setDetailPhoto(null)
    setSelectedPhotoIds([])
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
  const rejectingPhoto = photos.find((photo) => text(photo.id) === rejectingPhotoId) ?? null
  const selectedReasonLabel = REVIEW_REASONS.find((reason) => reason.value === reasonCode)?.label ?? ''

  const openDetail = async (id: string) => {
    if (!selectedAccountId) return
    setView('detail')
    setDetailPhoto(null)
    setDetailLoading(true)
    try {
      const response = await api.nenMembers.photo(id, selectedAccountId)
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

  const pendingPhotos = photos.filter((photo) => text(photo.status) === 'pending')
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
      setReasonCode('quality')
      setReasonNote('')
      setReasonError('')
      await load()
      setView('list')
    } catch (error) { setNotice(error instanceof Error ? error.message : '審査結果を保存できませんでした。') }
    finally { setReviewing(null) }
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
      onBack={() => setView('list')}
      onMove={(direction) => {
        const next = pendingPhotos[detailPosition + direction]
        if (next) void openDetail(text(next.id))
      }}
      onApprove={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted') }}
      onReturn={() => {
        if (!detailPhoto) return
        setView('list')
        setRejectingPhotoId(text(detailPhoto.id))
      }}
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
            {countsReady ? counts.pending : '—'}
            <span className="ml-0.5 text-xs font-normal text-ink-faint">枚</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">{countsReady && counts.pending > 0 ? '古いものから確認してください' : '新しい写真をお待ちしています'}</p>
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
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">—</p>
          <p className="mt-0.5 text-xs text-ink-faint">審査時間の集計API待ち</p>
        </div>
        <div className="rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-secondary">気をつけたい写真</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">—</p>
          <p className="mt-0.5 text-xs text-ink-faint">一覧向け注意候補API待ち</p>
        </div>
      </div>

      <div className="rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent">
        通す・戻すを押した時点で、投稿者へお礼や直してほしい点が届きます。戻すときは理由を選び、送る文章を確認できます。
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-control bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">{selectedPhotoIds.length}枚を選択中</span>
          <Button variant="primary" disabled title="一括審査APIがつながると使えます">まとめて通す</Button>
          <Button variant="secondary" disabled title="一括審査APIがつながると使えます">まとめて戻す</Button>
          <span className="text-xs text-ink-faint">一括審査はAPI接続待ちです</span>
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
            <img src={text(photo.image_url)} alt={`${text(photo.pet_name)}ちゃんの投稿写真`} className="h-full w-full object-cover" />
            <label className="absolute left-2 top-2 flex cursor-pointer items-center gap-1.5 rounded-control border border-hairline bg-canvas px-2 py-1 text-xs font-semibold text-ink-secondary"><input type="checkbox" checked={selected} onChange={() => togglePhotoSelection(photoId)} className="accent-accent" /><span>選ぶ</span></label>
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-ink">{text(photo.pet_name)}ちゃん</p><p className="mt-1 text-xs text-ink-faint">{text(photo.owner_name) || '名前未取得'}・{formatPhotoReceivedAt(photo.created_at)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${photo.status === 'pending' ? 'bg-status-warn-soft text-status-warn-deep' : photo.status === 'adopted' ? 'bg-accent-soft text-accent-hover' : 'bg-canvas-sunken text-ink-faint'}`}>{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '通しました' : '戻しました'}</span></div>
            <p className="mt-2 min-h-5 truncate text-sm text-ink-secondary" title={text(photo.caption) || 'コメントなし'}>{text(photo.caption) || 'コメントなし'}</p>
            {photo.status === 'adopted' && <p className="mt-3 rounded-control bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-hover">5ポイント付与済み・{photo.publication_consent_at && !photo.publication_withdrawn_at ? '公開中' : '公開は未同意'}</p>}
            {photo.status === 'rejected' && <div className="mt-3 rounded-control bg-surface-pearl px-3 py-2 text-xs text-ink-secondary"><span className="font-semibold">見送った理由：</span>{REVIEW_REASONS.find((reason) => reason.value === photo.review_reason_code)?.label ?? '理由未記録'}{text(photo.review_reason_note) && <p className="mt-1 text-ink-faint">{text(photo.review_reason_note)}</p>}</div>}
            {photo.review_notification_status === 'failed' && <div className="mt-2 flex items-center justify-between gap-3 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep"><span>投稿者へのLINE通知を送れませんでした</span><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => void retryNotification(text(photo.id))} className="shrink-0">{reviewing === photo.id ? '再送中...' : 'LINE通知を再送'}</Button></div>}
            {photo.status === 'pending' && <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="primary" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'adopted')}>{reviewing === photo.id ? '処理中...' : '通す'}</Button><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => { setRejectingPhotoId(text(photo.id)); setReasonCode('quality'); setReasonNote(''); setReasonError('') }}>戻す</Button></div>}
          </div>
        </article>})}
      </section>}
      </div>

      <div data-design="Right" className={styles.stack}>
        <section className={styles.sideCard}>
          <h2 className={styles.sideTitle}>確認順を決める条件</h2>
          <p className={styles.sideMissingValue}>—</p>
          <p className={styles.sideNote}>
            注意候補APIがつながると、確認を急ぐ写真を先に並べます。通す・戻す・公開する判断は、必ず人が行います。
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
    {rejectingPhoto && <Dialog open title="写真を戻す理由を選ぶ" description="選んだ理由と補足は記録され、投稿者へLINEで届きます。" tone="destructive" busy={Boolean(reviewing)} error={reasonError} confirmLabel="この理由で戻す" cancelLabel="審査へ戻る" onCancel={() => { setRejectingPhotoId(null); setReasonError('') }} onConfirm={() => {
      if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
      void review(text(rejectingPhoto.id), 'rejected', { reasonCode, reasonNote: reasonNote.trim() })
    }}>
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <img src={text(rejectingPhoto.image_url)} alt={`${text(rejectingPhoto.pet_name)}ちゃんの投稿写真`} className="aspect-square w-full rounded-xl object-cover" />
          <div className="space-y-4">
            <div className="rounded-control bg-surface-pearl px-3 py-2 text-sm text-ink-secondary">
              <p className="font-semibold text-ink">
                {text(rejectingPhoto.pet_name)}ちゃん／{text(rejectingPhoto.owner_name) || 'お名前は未取得'}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {formatPhotoReceivedAt(rejectingPhoto.created_at)} に届きました
              </p>
              <p className="mt-1 text-xs text-ink-faint">この方を前に戻した回数は未取得です</p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink">戻す理由</legend>
              {REVIEW_REASONS.map((reason) => <label key={reason.value} className="flex cursor-pointer items-start gap-2 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink-secondary"><input type="radio" name="photo-review-reason" value={reason.value} checked={reasonCode === reason.value} onChange={() => { setReasonCode(reason.value); setReasonError('') }} className="mt-0.5" /><span><span className="font-medium text-ink">{reason.label}</span><span className="mt-1 block text-xs text-ink-faint">投稿者へ：今回は「{reason.label}」のため、掲載を見送らせていただきました。</span></span></label>)}
            </fieldset>
            <label className="block text-sm font-semibold text-ink">投稿者に届く補足（直せます）<textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value.slice(0, 500)); setReasonError('') }} rows={3} placeholder={reasonCode === 'other' ? '理由を入力してください' : '必要な場合だけ入力します'} className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
            <div className="rounded-control border border-accent-border bg-accent-soft p-3 text-sm text-ink-secondary"><p className="font-semibold text-ink">投稿者に届く内容</p><p className="mt-1 whitespace-pre-line">お写真をご投稿いただきありがとうございます。{`\n`}今回は「{selectedReasonLabel}」のため、掲載を見送らせていただきました。{reasonNote && `\n${reasonNote}`}{`\n`}内容をご確認のうえ、よろしければ別のお写真をご投稿ください。</p></div>
          </div>
        </div>
    </Dialog>}
  </>
}
