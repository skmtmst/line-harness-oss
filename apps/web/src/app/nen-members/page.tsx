'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import { formatPhotoReceivedAt } from './photo-review-time'

type PhotoStatus = 'all' | 'pending' | 'adopted' | 'rejected'
type ReviewReasonCode = 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'
const REVIEW_REASONS: Array<{ value: ReviewReasonCode; label: string }> = [
  { value: 'quality', label: '写真が暗い・ぼやけている' },
  { value: 'privacy', label: '人の顔や個人情報が写っている' },
  { value: 'unrelated', label: 'ペットと関係のない内容が写っている' },
  { value: 'duplicate', label: '同じ写真がすでに投稿されている' },
  { value: 'other', label: 'そのほか' },
]
const text = (value: unknown) => String(value ?? '')

export default function PhotoReviewsPage() {
  const { selectedAccountId } = useAccount()
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
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
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await api.nenMembers.photos(selectedAccountId)
      if (sequence !== loadSequence.current) return
      if (response.success) setPhotos(response.data)
    } catch (error) {
      if (sequence === loadSequence.current) {
        setPhotos([])
        setNotice(error instanceof Error ? error.message : '写真を読み込めませんでした。')
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
        ? `採用し、ECへ${response.data.awardedPoints}ポイントを付与しました。公開は本人の同意がある場合だけ行います。${notification}`
        : `見送る理由を保存しました。${notification}`)
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
          {counts.pending}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">確認をお待ちしています</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">承認済</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.adopted}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開してよいと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">見送り</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.rejected}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開しないと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">投稿の合計</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.all}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">これまでに届いた数</p>
      </div>
    </div>
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {notice && <div className="rounded-v6-control border border-v6-accent-border bg-v6-accent-soft px-4 py-3 text-sm text-v6-accent-hover">{notice}</div>}

      <div className="flex gap-2 overflow-x-auto rounded-v6-card border border-hairline bg-canvas p-2">
        {([['pending', '審査待ち'], ['adopted', '採用済み'], ['rejected', '見送り'], ['all', 'すべて']] as Array<[PhotoStatus, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setStatus(value)} className={`whitespace-nowrap rounded-v6-control px-4 py-2.5 text-sm font-semibold ${status === value ? 'bg-v6-accent text-on-accent' : 'text-v6-ink-secondary hover:bg-v6-surface'}`}>{label}（{counts[value]}）</button>)}
      </div>

      {!selectedAccountId ? <div className="rounded-v6-card border border-hairline bg-v6-warning-bg p-12 text-center text-sm text-v6-warning">上のバーでLINEアカウントを選んでください。</div> : loading ? <div className="rounded-v6-card border border-hairline bg-canvas p-12 text-center text-sm text-v6-ink-faint">写真を読み込んでいます...</div> : visiblePhotos.length === 0 ? <div className="rounded-v6-card border border-dashed border-hairline bg-canvas p-12 text-center text-sm text-v6-ink-faint">この状態の写真はありません。</div> : <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visiblePhotos.map((photo) => <article key={text(photo.id)} className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
          <img src={text(photo.image_url)} alt={`${text(photo.pet_name)}ちゃんの投稿写真`} className="aspect-square w-full object-cover" />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-v6-ink">{text(photo.pet_name)}ちゃん</p><p className="mt-1 text-xs text-v6-ink-faint">{text(photo.owner_name) || '名前未取得'}・{formatPhotoReceivedAt(photo.created_at)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${photo.status === 'pending' ? 'bg-v6-warning-bg text-v6-warning' : photo.status === 'adopted' ? 'bg-v6-accent-soft text-v6-accent-hover' : 'bg-v6-surface-strong text-v6-ink-faint'}`}>{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '採用' : '見送り'}</span></div>
            <p className="mt-3 min-h-10 text-sm leading-5 text-v6-ink-secondary">{text(photo.caption) || 'コメントなし'}</p>
            {photo.status === 'adopted' && <p className="mt-3 rounded-v6-control bg-v6-accent-soft px-3 py-2 text-xs font-semibold text-v6-accent-hover">5ポイント付与済み・{photo.publication_consent_at && !photo.publication_withdrawn_at ? '公開中' : '公開は未同意'}</p>}
            {photo.status === 'rejected' && <div className="mt-3 rounded-v6-control bg-v6-surface px-3 py-2 text-xs text-v6-ink-secondary"><span className="font-semibold">見送った理由：</span>{REVIEW_REASONS.find((reason) => reason.value === photo.review_reason_code)?.label ?? '理由未記録'}{text(photo.review_reason_note) && <p className="mt-1 text-v6-ink-faint">{text(photo.review_reason_note)}</p>}</div>}
            {photo.review_notification_status === 'failed' && <div className="mt-2 flex items-center justify-between gap-3 rounded-v6-control bg-v6-warning-bg px-3 py-2 text-xs font-semibold text-v6-warning"><span>投稿者へのLINE通知を送れませんでした</span><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => void retryNotification(text(photo.id))} className="shrink-0">{reviewing === photo.id ? '再送中...' : 'LINE通知を再送'}</Button></div>}
            {photo.status === 'pending' && <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" disabled={reviewing === photo.id} onClick={() => { setRejectingPhotoId(text(photo.id)); setReasonCode('quality'); setReasonNote(''); setReasonError('') }}>理由を選んで見送る</Button><Button variant="primary" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'adopted')}>{reviewing === photo.id ? '処理中...' : '採用して5pt付与'}</Button></div>}
          </div>
        </article>)}
      </section>}
    </main>
    {rejectingPhoto && <Dialog open title="写真を戻す理由を選ぶ" description="選んだ理由と補足は記録され、投稿者へLINEで届きます。" tone="destructive" busy={Boolean(reviewing)} error={reasonError} confirmLabel="この理由で見送る" cancelLabel="審査へ戻る" onCancel={() => { setRejectingPhotoId(null); setReasonError('') }} onConfirm={() => {
      if (reasonCode === 'other' && !reasonNote.trim()) { setReasonError('そのほかの理由を入力してください'); return }
      void review(text(rejectingPhoto.id), 'rejected', { reasonCode, reasonNote: reasonNote.trim() })
    }}>
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <img src={text(rejectingPhoto.image_url)} alt={`${text(rejectingPhoto.pet_name)}ちゃんの投稿写真`} className="aspect-square w-full rounded-xl object-cover" />
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-v6-ink">見送る理由</legend>
              {REVIEW_REASONS.map((reason) => <label key={reason.value} className="flex cursor-pointer items-start gap-2 rounded-v6-control border border-hairline px-3 py-2.5 text-sm text-v6-ink-secondary"><input type="radio" name="photo-review-reason" value={reason.value} checked={reasonCode === reason.value} onChange={() => { setReasonCode(reason.value); setReasonError('') }} className="mt-0.5" /><span>{reason.label}</span></label>)}
            </fieldset>
            <label className="block text-sm font-semibold text-v6-ink">投稿者への補足<textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value.slice(0, 500)); setReasonError('') }} rows={3} placeholder={reasonCode === 'other' ? '理由を入力してください' : '必要な場合だけ入力します'} className="mt-2 w-full rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-v6-ink" /></label>
            <div className="rounded-v6-control border border-v6-accent-border bg-v6-accent-soft p-3 text-sm text-v6-ink-secondary"><p className="font-semibold text-v6-ink">投稿者に届く内容</p><p className="mt-1 whitespace-pre-line">お写真をご投稿いただきありがとうございます。{`\n`}今回は「{selectedReasonLabel}」のため、掲載を見送らせていただきました。{reasonNote && `\n${reasonNote}`}{`\n`}内容をご確認のうえ、よろしければ別のお写真をご投稿ください。</p></div>
          </div>
        </div>
    </Dialog>}
  </>
}
