'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import { formatPhotoReceivedAt } from './photo-review-time'
import styles from './photo-review.module.css'

type PhotoStatus = 'all' | 'pending' | 'adopted' | 'rejected'
type ReviewReasonCode = 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'
const REVIEW_REASONS: Array<{ value: ReviewReasonCode; label: string }> = [
  { value: 'quality', label: '写真が暗い・ぼやけている' },
  { value: 'privacy', label: '人の顔や個人情報が写っている' },
  { value: 'unrelated', label: 'ペットと関係のない内容が写っている' },
  { value: 'duplicate', label: '同じ写真がすでに投稿されている' },
  { value: 'other', label: 'そのほか' },
]
const STATUS_TABS: ReadonlyArray<[PhotoStatus, string]> = [
  ['pending', '審査待ち'],
  ['adopted', '通したもの'],
  ['rejected', '戻したもの'],
  ['all', 'すべて'],
]
const text = (value: unknown) => String(value ?? '')

export default function PhotoReviewsPage() {
  const { selectedAccountId } = useAccount()
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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
    try {
      const response = await api.nenMembers.photos(selectedAccountId)
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error('load_failed')
      setPhotos(response.data)
    } catch {
      if (sequence === loadSequence.current) {
        setPhotos([])
        setLoadError('写真を読み込めませんでした。')
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
  }, [selectedAccountId])

  const counts = useMemo(() => ({
    all: photos.length,
    pending: photos.filter((photo) => text(photo.status) === 'pending').length,
    adopted: photos.filter((photo) => text(photo.status) === 'adopted').length,
    rejected: photos.filter((photo) => text(photo.status) === 'rejected').length,
  }), [photos])
  const visiblePhotos = useMemo(() => status === 'all' ? photos : photos.filter((photo) => text(photo.status) === status), [photos, status])
  const countsReady = Boolean(selectedAccountId) && !loading && !loadError
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
        ...(rejection ?? {}),
      })
      if (!response.success) throw new Error(response.error)
      const notification = response.data.notificationStatus === 'sent'
        ? '投稿者へLINEで通知しました。'
        : '審査結果は保存しましたが、LINE通知は送れませんでした。一覧から再送できます。'
      setNotice(nextStatus === 'adopted'
        ? `写真を通し、ECへ${response.data.awardedPoints}ポイントを付与しました。公開は本人の同意がある場合だけ行います。${notification}`
        : `戻す理由を保存しました。${notification}`)
      setRejectingPhotoId(null)
      setReasonCode('quality')
      setReasonNote('')
      setReasonError('')
      await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '審査結果を保存できませんでした。') }
    finally { setReviewing(null) }
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

  return <>
    <div data-design="KPIs" className="mx-auto mb-4 grid max-w-7xl grid-cols-1 gap-4 px-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">未審査</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {countsReady ? counts.pending : '—'}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">確認をお待ちしています</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">通したもの</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {countsReady ? counts.adopted : '—'}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開してよいと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">戻したもの</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {countsReady ? counts.rejected : '—'}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開しないと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">投稿の合計</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {countsReady ? counts.all : '—'}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">これまでに届いた数</p>
      </div>
    </div>
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {notice && <div className="rounded-control border border-accent-border bg-accent-soft px-4 py-3 text-sm text-accent-hover">{notice}</div>}

      {/*
        * 状態の切り替えはタブ帯（高さ44）で出す。設計 `Qu6Vk` は共通の
        * ページ内タブで、押しボタンを並べた帯ではない。件数が取れていない
        * ときは `—` を出す。0件と読み替えない。
        */}
      <Tabs
        items={STATUS_TABS.map(([value, label]) => ({
          label: `${label}（${countsReady ? counts[value] : '—'}）`,
          current: status === value,
          onClick: () => setStatus(value),
        }))}
      />

      <div className={styles.body}>
      <div className="min-w-0 space-y-6">
      {!selectedAccountId ? <ListState kind="empty" title="LINEアカウントを選んでください" description="上のバーから、写真審査を行うLINEアカウントを選びます。" /> : loading ? <ListState kind="loading" title="写真を読み込んでいます" /> : loadError ? <ListState kind="error" title="写真を読み込めませんでした" description="通信状態を確認して、もう一度読み込んでください。" action={<Button onClick={() => void load()}>写真を再読み込み</Button>} /> : visiblePhotos.length === 0 ? <ListState kind="empty" title="この状態の写真はありません" description="別の状態を選ぶか、新しい写真が届くまでお待ちください。" /> : <section className="grid gap-4 sm:grid-cols-2">
        {visiblePhotos.map((photo) => <article key={text(photo.id)} className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card">
          <img src={text(photo.image_url)} alt={`${text(photo.pet_name)}ちゃんの投稿写真`} className="aspect-square w-full object-cover" />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-ink">{text(photo.pet_name)}ちゃん</p><p className="mt-1 text-xs text-ink-faint">{text(photo.owner_name) || '名前未取得'}・{formatPhotoReceivedAt(photo.created_at)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${photo.status === 'pending' ? 'bg-status-warn-soft text-status-warn-deep' : photo.status === 'adopted' ? 'bg-accent-soft text-accent-hover' : 'bg-canvas-sunken text-ink-faint'}`}>{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '通しました' : '戻しました'}</span></div>
            <p className="mt-3 min-h-10 text-sm leading-5 text-ink-secondary">{text(photo.caption) || 'コメントなし'}</p>
            {photo.status === 'adopted' && <p className="mt-3 rounded-control bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-hover">5ポイント付与済み・{photo.publication_consent_at && !photo.publication_withdrawn_at ? '公開中' : '公開は未同意'}</p>}
            {photo.status === 'rejected' && <div className="mt-3 rounded-control bg-surface-pearl px-3 py-2 text-xs text-ink-secondary"><span className="font-semibold">見送った理由：</span>{REVIEW_REASONS.find((reason) => reason.value === photo.review_reason_code)?.label ?? '理由未記録'}{text(photo.review_reason_note) && <p className="mt-1 text-ink-faint">{text(photo.review_reason_note)}</p>}</div>}
            {photo.review_notification_status === 'failed' && <div className="mt-2 flex items-center justify-between gap-3 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep"><span>投稿者へのLINE通知を送れませんでした</span><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => void retryNotification(text(photo.id))} className="shrink-0">{reviewing === photo.id ? '再送中...' : 'LINE通知を再送'}</Button></div>}
            {photo.status === 'pending' && <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => { setRejectingPhotoId(text(photo.id)); setReasonCode('quality'); setReasonNote(''); setReasonError('') }}>理由を選んで戻す</Button><Button variant="primary" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'adopted')}>{reviewing === photo.id ? '処理中...' : '通して5pt付与'}</Button></div>}
          </div>
        </article>)}
      </section>}
      </div>

      <div data-design="Right" className={styles.stack}>
        <section className={styles.sideCard}>
          <h2 className={styles.sideTitle}>自動で戻す条件</h2>
          <p className={styles.sideMissingValue}>—</p>
          <p className={styles.sideNote}>
            まだ繋がっていません。自動審査の口が接続されると表示されます。公開するかどうかは、いまも人が決めます。
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
            { label: 'NEN配信', note: '通した写真はここで配信します', href: '/nen-campaigns' },
            { label: 'LINE通知', note: '審査結果の連絡はここから届きます', href: '/line-notifications' },
            { label: 'EC連携', note: 'ポイントの付与先です', href: '/ec-commerce' },
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
