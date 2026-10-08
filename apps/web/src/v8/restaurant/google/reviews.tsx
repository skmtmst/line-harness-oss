'use client'

/*
 * ★V8 Googleビジネス 口コミ（一覧 `j0Wcg`・返信を作る `x9HIR`・公開の確認 `xSudF`）。
 * 口（一覧・絞り込み・並び・同期・下書き作成・保存・公開）は今の画面と同じ。
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import {
  restaurantGoogleApi,
  type GoogleConnectionData,
  type GoogleReview,
  type GoogleReviewFilter,
  type GoogleReviewListData,
  type GoogleReviewOrder,
} from '@/lib/restaurant-google-api'
import { Stat, StatRow } from '../common-a/parts'
import { errorMessage, formatShortStamp, reviewReceivedAt } from './format'
import type { GoogleNav } from './google'
import styles from './google.module.css'

const STATE_OPTIONS: Array<{ value: GoogleReviewFilter; label: string }> = [
  { value: 'all', label: '状態：すべて' },
  { value: 'unreplied', label: '状態：未返信' },
  { value: 'draft', label: '状態：下書きあり' },
  { value: 'attention', label: '状態：要確認' },
]

const ORDER_OPTIONS: Array<{ value: GoogleReviewOrder; label: string }> = [
  { value: 'newest', label: '並び：新しい順' },
  { value: 'oldest', label: '並び：古い順' },
  { value: 'rating_low', label: '並び：評価が低い順' },
  { value: 'rating_high', label: '並び：評価が高い順' },
]

const RATING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '評価：すべて' },
  ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `評価：★${n}` })),
]

/** 星（★の文字）。評価2以下は赤、ほかは金。 */
export function Stars({ rating, small = false }: { rating: number; small?: boolean }) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)))
  return (
    <span className={`${styles.stars} ${safe <= 2 ? styles.starsLow : ''} ${small ? styles.starsSmall : ''}`} aria-label={`評価 ${safe}／5`} role="img">
      {'★'.repeat(safe) + '☆'.repeat(5 - safe)}
    </span>
  )
}

export function replyBadge(review: GoogleReview): { label: string; tone: StatusBadgeTone } {
  if (review.replyStatus === 'published') return { label: '返信済み', tone: 'success' }
  if (review.replyStatus === 'replied' || review.replyStatus === 'pending_confirm') return { label: '反映確認中', tone: 'warning' }
  if (review.replyStatus === 'draft') return { label: review.replyDraftAiGenerated ? 'AI下書きあり' : '下書きあり', tone: 'info' }
  if (review.needsAttention) return { label: '要確認', tone: 'danger' }
  return { label: '未返信', tone: 'warning' }
}

export function ReviewsBoard({ accountId, data, go, onSynced }: { accountId: string; data: GoogleConnectionData; go: GoogleNav; onSynced: () => void }) {
  const [filter, setFilter] = useState<GoogleReviewFilter>('all')
  const [rating, setRating] = useState('')
  const [order, setOrder] = useState<GoogleReviewOrder>('newest')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<GoogleReviewListData | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncedOnce, setSyncedOnce] = useState(false)
  const { connection } = data

  const load = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const ratingNumber = Number.parseInt(rating, 10)
      setList(await restaurantGoogleApi.listReviews(accountId, { filter, order, q: appliedSearch || undefined, page, perPage: 20, rating: Number.isInteger(ratingNumber) ? ratingNumber : undefined }))
    } catch (err) {
      setList(null)
      setListError(errorMessage(err, '口コミを読み込めませんでした。'))
    } finally {
      setListLoading(false)
    }
  }, [accountId, appliedSearch, filter, order, page, rating])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const sync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    setSyncError('')
    try {
      await restaurantGoogleApi.syncReviews(accountId)
      onSynced()
      await load()
    } catch (err) {
      setSyncError(errorMessage(err, 'Googleから口コミを読み込めませんでした。前回取得した内容を表示しています。'))
    } finally {
      setSyncing(false)
    }
  }, [accountId, load, onSynced, syncing])

  // 画面を開いたとき、最終同期が古ければ裏で1回だけ同期する（前回の一覧はそのまま見せる）。
  useEffect(() => {
    if (syncedOnce || connection.status !== 'connected' || !data.summary.syncStale) return
    setSyncedOnce(true)
    void sync()
  }, [connection.status, data.summary.syncStale, sync, syncedOnce])

  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.perPage)) : 1
  const average = connection.averageRating
  const reviewTotal = connection.totalReviewCount ?? data.summary.storedCount

  return (
    <>
      <StatRow>
        <Stat size="small" label="未返信" value={`${data.summary.unrepliedCount}`} note="返信を待っている口コミ" warning={data.summary.unrepliedCount > 0} />
        <Stat size="small" label="平均の評価" value={average === null || average === undefined ? '—' : `${Math.round(average * 10) / 10}`} note={`この30日・${reviewTotal}件`} />
        <Stat size="small" label="要確認" value={`${data.summary.attentionCount}`} note="評価2以下" />
        {/* Google経由の予約：結ぶ口がまだ無いので「—」（数を推測しない）。 */}
        <Stat size="small" label="Google経由の予約" value="—" note="この30日" help="予約の連携サービスと結ぶと数えます。いまは取れないので「—」です。" />
      </StatRow>
      <div className={styles.toolbar}>
        <span className={styles.search}>
          <SearchField placeholder="口コミを探す" aria-label="口コミを探す" value={search} onChange={setSearch} onClear={() => setSearch('')} />
        </span>
        <Select aria-label="評価で絞り込み" width={150} value={rating} onChange={(value) => { setRating(value); setPage(1) }} options={RATING_OPTIONS} />
        <Select aria-label="状態で絞り込み" width={160} value={filter} onChange={(value) => { setFilter(value as GoogleReviewFilter); setPage(1) }} options={STATE_OPTIONS} />
        <span className={styles.spacer} aria-hidden="true" />
        <IconButton
          aria-label={syncing ? 'Googleから取得中…' : 'Googleから同期する'}
          onClick={() => void sync()}
          disabled={syncing || connection.status !== 'connected'}
        >
          <RefreshCw aria-hidden className={`${styles.icon16} ${syncing ? styles.spin : ''}`} />
        </IconButton>
        <Select aria-label="並び順" width={150} value={order} onChange={(value) => { setOrder(value as GoogleReviewOrder); setPage(1) }} options={ORDER_OPTIONS} />
      </div>
      {connection.status === 'expired' ? <Notice tone="danger" action={<Link href="/restaurant-test/google?tab=settings" className={styles.textLink}>設定で再接続</Link>}>Googleとの接続を確認してください（認可切れ）。前回取得した口コミを表示しています。</Notice> : null}
      {connection.status === 'no_permission' ? <Notice tone="danger" action={<Link href="/restaurant-test/google?tab=settings" className={styles.textLink}>設定で接続を確認</Link>}>この店舗を操作する権限がありません。</Notice> : null}
      {syncError ? <Notice tone="warn" action={<button type="button" className={styles.textButton} onClick={() => void sync()}>もう一度</button>}>{syncError}</Notice> : null}
      {syncing && (list?.total ?? 0) === 0 ? <Notice tone="info">口コミを取得中… すべてのページを取得してから表示します。</Notice> : null}
      {listLoading && !list ? <div className={styles.stateBox}><ListState kind="loading" title="口コミを読み込んでいます" /></div> : null}
      {listError ? <div className={styles.stateBox}><ListState kind="error" title="口コミを表示できませんでした" description={listError} onRetry={() => void load()} /></div> : null}
      {list && list.total === 0 && !listLoading ? (
        <div className={styles.stateBox}>
          <ListState
            kind="empty"
            title={filter === 'all' ? 'まだ口コミがありません' : 'その状態の口コミはありません'}
            description={filter === 'all' ? '同期しても0件のときは、Google側にまだ口コミがありません。評価を推測して表示することはしません。' : '絞り込みを変えると他の口コミを確認できます。'}
            emptyPreset="readonly"
          />
        </div>
      ) : null}
      {list && list.total > 0 ? (
        <div role="table" aria-label="口コミ" className={styles.table}>
          <div role="row" className={styles.headRow}>
            <span role="columnheader" className={`${styles.cell} ${styles.colReviewer}`}>投稿者・評価</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colComment}`}>口コミ</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colReceived}`}>受信</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colState}`}>状態</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colOps}`}><span className="sr-only">操作</span></span>
          </div>
          {list.reviews.map((review) => {
            const badge = replyBadge(review)
            const actionable = review.replyStatus === 'unreplied' || review.replyStatus === 'draft' || review.replyStatus === 'pending_confirm'
            return (
              <div key={review.id} role="row" className={styles.row}>
                <span role="cell" className={`${styles.cell} ${styles.colReviewer}`}>
                  <span className={styles.reviewer}>{review.reviewerDisplayName ?? '匿名'}</span>
                  <Stars rating={review.starRating} />
                </span>
                <span role="cell" className={`${styles.cell} ${styles.colComment}`}>
                  <span className={styles.comment} title={review.comment ?? undefined}>{review.comment ?? '（本文なし・評価のみ）'}</span>
                </span>
                <span role="cell" className={`${styles.cell} ${styles.colReceived}`}>{formatShortStamp(reviewReceivedAt(review))}</span>
                <span role="cell" className={`${styles.cell} ${styles.colState}`}><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></span>
                <span role="cell" className={`${styles.cell} ${styles.colOps}`}>
                  <Button onClick={() => go({ tab: 'reviews', view: 'draft', id: review.id })}>{actionable ? '下書きを作る' : '返信を見る'}</Button>
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
      {list && pageCount > 1 ? (
        <div className={styles.pager}>
          <span className={styles.pagerNote}>{`${list.total}件 ・ 新着と未返信は別に管理`}</span>
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      ) : null}
      <p className={styles.footNote}>返信文は手で書くか、AIで下書きを作れます。Googleへ送ると「反映確認中」になり、反映されると「返信済み」になります。</p>
    </>
  )
}

/** 返信を作る（x9HIR）＋公開の確認（xSudF）。 */
export function ReviewDraft({ accountId, reviewId, data, go, onPublished }: { accountId: string; reviewId: string; data: GoogleConnectionData; go: GoogleNav; onPublished: () => void }) {
  const canPublish = data.permissions.canPublishReply
  const [review, setReview] = useState<GoogleReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [aiGenerated, setAiGenerated] = useState(false)
  const [busy, setBusy] = useState<'generate' | 'save' | 'publish' | null>(null)
  const [actionError, setActionError] = useState('')
  const [saved, setSaved] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [checked, setChecked] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [done, setDone] = useState<{ comment: string } | null>(null)
  // 未保存の下書きがあるまま一覧や他画面へ移ろうとしたら止める（今の画面と同じ）。
  const dirty = review !== null && done === null && review.replyStatus !== 'published' && review.replyStatus !== 'replied' && text !== (review.replyDraft ?? '')
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: busy !== null })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await restaurantGoogleApi.review(accountId, reviewId)
      setReview(response.review)
      setText(response.review.replyDraft ?? '')
      setAiGenerated(response.review.replyDraftAiGenerated)
    } catch (err) {
      setLoadError(errorMessage(err, '口コミを読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, reviewId])

  useEffect(() => { void load() }, [load])

  const generate = async (mode: 'new' | 'shorter' | 'polite') => {
    setBusy('generate')
    setActionError('')
    setSaved('')
    try {
      // 書き換えは、保存前に画面で直した内容をそのまま元にする。
      const response = await restaurantGoogleApi.generateDraft(accountId, reviewId, mode, text)
      setText(response.draft)
      setAiGenerated(true)
    } catch (err) {
      setActionError(errorMessage(err, 'AIの下書き作成に失敗しました。もう一度お試しください。'))
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setActionError('')
    try {
      const response = await restaurantGoogleApi.saveDraft(accountId, reviewId, text)
      setReview(response.review)
      setAiGenerated(false)
      setSaved('下書きを保存しました。まだGoogleには送信していません。')
    } catch (err) {
      setActionError(errorMessage(err, '下書きを保存できませんでした。'))
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    setBusy('publish')
    setActionError('')
    try {
      const response = await restaurantGoogleApi.publishReply(accountId, reviewId, text)
      setDone({ comment: response.reply.comment })
      setConfirming(false)
      onPublished()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'already_replied') {
        const existing = (err.data as { existingReply?: string } | undefined)?.existingReply
        setConflict(existing ?? '（返信文を読み込めませんでした）')
        setConfirming(false)
      } else if (err instanceof ApiError && err.status === 502) {
        setActionError('Googleへの送信結果を確認できませんでした。重複を防ぐため、次に開いたときGoogle側の状態を照合してから再送します。')
        setConfirming(false)
        await load()
      } else {
        setActionError(errorMessage(err, 'Googleへの返信に失敗しました。'))
      }
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className={styles.stateBox}><ListState kind="loading" title="口コミを読み込んでいます" /></div>
  if (loadError || !review) {
    return <ListState kind="error" title="口コミを表示できませんでした" description={loadError} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'reviews' })}>口コミ一覧へ戻る</Button>} />
  }

  const reviewer = review.reviewerDisplayName ?? '匿名'
  const storeTitle = data.connection.locationTitle ?? data.store.name
  const alreadyReplied = review.replyStatus === 'published' || review.replyStatus === 'replied' || Boolean(done)
  const pendingConfirm = review.replyStatus === 'pending_confirm'
  const textLength = text.trim().length
  const canOpenConfirm = canPublish && data.writeEnabled && textLength > 0 && textLength <= 4096 && !alreadyReplied && busy === null
  const sourceUrl = data.connection.locationMapsUrl
    ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeTitle)}`

  if (confirming) {
    return (
      <div className={styles.split} data-design-node="xSudF">
        <div className={styles.mainColumn}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>この返信をGoogleに公開しますか？</h2>
            <dl className={styles.facts}>
              <div className={styles.factRow}><dt className={styles.factKey}>返信先の店舗</dt><dd className={styles.factValue}>{storeTitle}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>返信する口コミ</dt><dd className={styles.factValue}>{`${reviewer}（★${review.starRating}・${formatShortStamp(reviewReceivedAt(review))}）`}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>公開のタイミング</dt><dd className={styles.factValue}>送信後、Googleの処理を経て表示</dd></div>
            </dl>
            <p className={styles.preText}>{text}</p>
            <p className={styles.muted}>{`元の口コミ：${review.comment ?? '（本文なし・評価のみ）'}`}</p>
          </section>
        </div>
        <aside className={`${styles.card} ${styles.sideColumn}`} aria-label="公開前の確認">
          <h3 className={styles.cardTitle}>公開前の確認</h3>
          <Checkbox checked={checked} onCheckedChange={setChecked}>返信先・内容・個人情報の有無を確認しました</Checkbox>
          <p className={styles.checklist}>{'・予約内容や来店履歴などを追記していません\n・返信は店舗を代表して公開されます\n・通信結果が不明な場合はGoogle側を先に確認します'}</p>
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
          <Button onClick={() => setConfirming(false)} disabled={busy !== null} className={styles.fullButton}>修正する</Button>
          <Button variant="primary" onClick={() => void publish()} disabled={!checked || busy !== null} busy={busy === 'publish'} busyLabel="送信中…" className={styles.fullButton}>この内容で返信する</Button>
        </aside>
      </div>
    )
  }

  return (
    <>
      {done ? <Notice tone="success">Googleに返信を送信しました。反映を確認できるまで「反映確認中」と表示します。</Notice> : null}
      {conflict !== null ? <Notice tone="danger">{`別の担当者がすでに返信しています。表示されている返信：「${conflict}」`}</Notice> : null}
      {pendingConfirm && !done ? <Notice tone="warn">前回の送信結果を確認できていません。「この内容で返信する」を押すと、先にGoogle側の状態を照合してから送信します。</Notice> : null}
      <div className={styles.split}>
        <div className={styles.mainColumn}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>返信する口コミ</h2>
            <p className={styles.reviewMeta}>
              <span className={styles.reviewMetaName}>{reviewer}</span>
              <Stars rating={review.starRating} small />
              <span className={styles.reviewMetaDate}>{formatShortStamp(reviewReceivedAt(review))}</span>
              <a href={sourceUrl} target="_blank" rel="noreferrer" className={styles.textLink}>Googleで原文を確認</a>
            </p>
            <p className={styles.reviewText}>{review.comment ?? '（本文なし・評価のみ）'}</p>
            {alreadyReplied && (review.replyComment || done) ? (
              <p className={styles.repliedBox}>{`公開済みの返信：${done?.comment ?? review.replyComment}`}</p>
            ) : null}
          </section>
          {!alreadyReplied ? (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{aiGenerated ? 'AIが作った返信の下書き' : '返信の下書き'}</h2>
              <textarea
                className={styles.draftInput}
                value={text}
                onChange={(event) => { setText(event.target.value); setSaved('') }}
                placeholder="返信文を入力するか、AIで下書きを作ります。"
                aria-label="返信文"
                aria-invalid={textLength > 4096 || undefined}
              />
              <div className={styles.draftTools}>
                {data.aiAvailable ? (
                  <>
                    <Button onClick={() => void generate('new')} disabled={busy !== null} busy={busy === 'generate'} busyLabel="作成中…"><Sparkles aria-hidden className={styles.icon15} />AIで下書きを作る</Button>
                    <Button onClick={() => void generate('shorter')} disabled={busy !== null || !text}>短くする</Button>
                    <Button onClick={() => void generate('polite')} disabled={busy !== null || !text}>丁寧にする</Button>
                  </>
                ) : <span className={styles.muted}>この環境ではAI下書きは使えません。</span>}
                <span className={styles.spacer} aria-hidden="true" />
                <span className={textLength > 4096 ? styles.countOver : styles.count}>{`${textLength.toLocaleString('ja-JP')} / 4,096`}</span>
              </div>
              {saved ? <p className={styles.saved} role="status">{saved}</p> : null}
              {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
            </section>
          ) : (
            <section className={styles.card}><p className={styles.muted}>この口コミへの返信は公開済みです。</p></section>
          )}
        </div>
        <aside className={`${styles.card} ${styles.sideColumn}`} aria-label="公開前の確認">
          <h3 className={styles.cardTitle}>公開前の確認</h3>
          <p className={styles.checklist}>{'・返信先が合っている\n・お客さまの個人情報を書いていない\n・お店の約束（値引きなど）を書いていない'}</p>
          <p className={styles.grayNote}>
            {!data.writeEnabled
              ? '検証環境では Google へは送りません。下書きと承認まで。'
              : canPublish ? '確認してから Google へ公開します。' : 'Googleへの公開は店舗管理者以上が行います。下書きを保存しておくと、管理者が確認して公開できます。'}
          </p>
          {!alreadyReplied ? (
            <>
              <Button onClick={() => void save()} disabled={busy !== null || textLength === 0 || textLength > 4096} busy={busy === 'save'} className={styles.fullButton}>下書きを保存する</Button>
              {canPublish && data.writeEnabled ? (
                <Button variant="primary" onClick={() => { setChecked(false); setActionError(''); setConfirming(true) }} disabled={!canOpenConfirm} className={styles.fullButton}>返信内容を確認</Button>
              ) : (
                /* 送れない設定（検証環境・権限なし）のときは送信へ進むボタンを出さない。場所だけ空ける。 */
                <span className={styles.buttonSpace} aria-hidden="true" />
              )}
            </>
          ) : null}
        </aside>
      </div>
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        description="このまま移ると、返信文の変更は失われます。下書き保存をしてから移るか、保存せずに移ってください。"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </>
  )
}
