'use client'

/*
 * ★V8-B Googleビジネス（板 `j0Wcg`＋子板6枚）。
 *
 * 口コミタブだけをV8の板に積み替える。データの口（一覧・絞り込み・並び順・
 * 同期・下書き画面への行き先）は v7（google-business.tsx）と同じ。
 * 投稿・パフォーマンス・プロフィール・設定タブと返信作成の画面は今の作りのまま
 * v7 を出す（V8 完成までの二重管理）。子板の印は V8 の外枠に付ける：
 * - `SrmVs` パフォーマンス：?tab=performance
 * - `JUTGz` プロフィール：?tab=profile（営業時間・変更履歴の状態を含む）
 * - `Cfed0` 投稿：?tab=posts（view なしの一覧）
 * - `T1j2Sw` 投稿を作る：?tab=posts&view=new|edit|confirm
 * - `CuHXG` 設定：?tab=settings（未接続のときも設定タブなので同じ印）
 * - `x9HIR` 返信を作る：?tab=reviews&view=draft
 * 見た目の V8 化（タブの中身の積み替え）は別段でやる。共通部品そのものは
 * 仕上げ係 M10 だけが変える。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 「Google経由の予約」の数：結ぶ口が無いので「—」にする。
 * - 平均の評価の「この30日・24件」：期間別の集計が無いので、接続の
 *   平均と取得済みの件数を出す。
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Star } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { restaurantTestApi, type RestaurantStore } from '@/lib/restaurant-test-api'
import {
  restaurantGoogleApi,
  type GoogleConnectionData,
  type GoogleReview,
  type GoogleReviewFilter,
  type GoogleReviewListData,
  type GoogleReviewOrder,
} from '@/lib/restaurant-google-api'
import GoogleBusinessPage from '../google/google-business'
import { errorMessage, formatDateTime } from '../google/google-format'
import { BoundaryBanner, Stat } from './shell'
import shellStyles from './shell.module.css'
import styles from './google.module.css'

const TAB_LABELS = { reviews: '口コミ', posts: '投稿', performance: 'パフォーマンス', profile: 'プロフィール', settings: '設定' } as const
type TabKey = keyof typeof TAB_LABELS

const STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '状態：すべて' },
  { value: 'unreplied', label: '状態：未返信' },
  { value: 'draft', label: '状態：下書きあり' },
  { value: 'attention', label: '状態：要確認' },
]

const ORDER_OPTIONS: Array<{ value: GoogleReviewOrder; label: string }> = [
  { value: 'newest', label: '新しい順' },
  { value: 'oldest', label: '古い順' },
  { value: 'rating_low', label: '評価が低い順' },
  { value: 'rating_high', label: '評価が高い順' },
]

const RATING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '評価：すべて' },
  ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `評価：★${n}` })),
]

function Stars({ rating }: { rating: number }) {
  return (
    <span className={styles.stars} aria-label={`評価 ${rating}／5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= rating ? 'currentColor' : 'none'} strokeWidth={1.5} className={n <= rating ? '' : styles.starsDim} />
      ))}
    </span>
  )
}

function replyBadge(review: GoogleReview): { label: string; tone: StatusBadgeTone } {
  if (review.replyStatus === 'published') return { label: '返信済み', tone: 'success' }
  if (review.replyStatus === 'replied') return { label: '反映確認中', tone: 'info' }
  if (review.replyStatus === 'pending_confirm') return { label: '反映確認中', tone: 'warning' }
  if (review.replyStatus === 'draft') return { label: review.replyDraftAiGenerated ? 'AI下書きあり' : '下書きあり', tone: 'info' }
  if (review.needsAttention) return { label: '要確認', tone: 'danger' }
  return { label: '未返信', tone: 'warning' }
}

function GoogleReviewsBoard({ data, stores }: { data: GoogleConnectionData; stores: RestaurantStore[] }) {
  const router = useRouter()
  const { selectedAccountId, setSelectedAccountId } = useAccount()
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

  const accountId = selectedAccountId ?? ''

  const load = useCallback(async () => {
    if (!accountId) return
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
    if (syncing || !accountId) return
    setSyncing(true)
    setSyncError('')
    try {
      await restaurantGoogleApi.syncReviews(accountId)
      await load()
    } catch (err) {
      setSyncError(errorMessage(err, 'Googleの口コミを読み込めませんでした。前回の一覧を表示しています。'))
    } finally {
      setSyncing(false)
    }
  }, [accountId, load, syncing])

  // 画面を開いたとき、最終同期が古ければ裏で1回だけ同期する（v7 と同じ）。
  useEffect(() => {
    if (syncedOnce || connection.status !== 'connected' || !data.summary.syncStale) return
    setSyncedOnce(true)
    void sync()
  }, [connection.status, data.summary.syncStale, sync, syncedOnce])

  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.perPage)) : 1
  const currentStoreId = stores.find((item) => item.line_account_id === accountId)?.id
    ?? stores.find((item) => item.id === data.store.id)?.id ?? ''
  const average = connection.averageRating
  const reviewTotal = connection.totalReviewCount ?? data.summary.storedCount

  const goTab = (tab: TabKey) => {
    router.push(`/restaurant-test/google${tab === 'reviews' ? '' : `?tab=${tab}`}`)
  }

  return (
    <div data-design-node="j0Wcg">
      <div className={shellStyles.head}>
        <div className={shellStyles.headText}>
          <h1 className={shellStyles.headTitle}>Googleビジネス</h1>
          <p className={shellStyles.headDescription}>Googleの口コミ・投稿・営業時間を、店舗ごとに管理します。</p>
        </div>
        {stores.length > 0 ? (
          <Select
            aria-label="店舗を選ぶ"
            className={shellStyles.storePicker}
            value={currentStoreId}
            onChange={(value) => {
              const next = stores.find((item) => item.id === value)
              if (next?.line_account_id && next.line_account_id !== accountId) setSelectedAccountId(next.line_account_id)
            }}
            options={stores.map((item) => ({ value: item.id, label: `店舗：${item.name}` }))}
          />
        ) : null}
      </div>
      <div className={shellStyles.body}>
        <BoundaryBanner />
        <nav className={styles.tabs} aria-label="Googleビジネスの機能">
          {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={styles.tab}
              aria-selected={key === 'reviews'}
              onClick={() => goTab(key)}
            >
              {TAB_LABELS[key]}{key === 'reviews' ? ` ${data.summary.storedCount}` : ''}
            </button>
          ))}
        </nav>
        <div className={shellStyles.stats}>
          <Stat label="未返信" value={`${data.summary.unrepliedCount}`} note="返信を待っている口コミ" warning={data.summary.unrepliedCount > 0} />
          <Stat label="平均の評価" value={average === null || average === undefined ? '—' : `${Math.round(average * 10) / 10}`} note={`この30日・${reviewTotal}件`} />
          <Stat label="要確認" value={`${data.summary.attentionCount}`} note="評価2以下" warning={data.summary.attentionCount > 0} />
          <Stat label="Google経由の予約" value="—" note="この30日" />
        </div>
        <div className={styles.toolbar}>
          <span className={styles.toolbarSearch}>
            <SearchField placeholder="口コミを探す" aria-label="口コミを探す" value={search} onChange={setSearch} onClear={() => setSearch('')} />
          </span>
          <Select aria-label="評価で絞り込み" value={rating} onChange={(value) => { setRating(value); setPage(1) }} options={RATING_OPTIONS} />
          <Select aria-label="状態で絞り込み" value={filter} onChange={(value) => { setFilter(value as GoogleReviewFilter); setPage(1) }} options={STATE_OPTIONS} />
          <span className={styles.toolbarRight}>
            <Select aria-label="並び順" value={order} onChange={(value) => { setOrder(value as GoogleReviewOrder); setPage(1) }} options={ORDER_OPTIONS} />
          </span>
        </div>
        {connection.status === 'expired' ? <Notice tone="danger">Googleとの接続を確認してください（認可切れ）。前回取得した口コミを表示しています。</Notice> : null}
        {connection.status === 'no_permission' ? <Notice tone="danger">この店舗を操作する権限がありません。</Notice> : null}
        {syncError ? <Notice tone="warn">{syncError}</Notice> : null}
        {listLoading && !list ? <div className={styles.stateBox}><ListState kind="loading" title="口コミを読み込んでいます" /></div> : null}
        {listError ? <div className={styles.stateBox}><ListState kind="error" title="口コミを表示できませんでした" description={listError} onRetry={() => void load()} /></div> : null}
        {list && list.total === 0 && !listLoading ? (
          <div className={styles.stateBox}>
            <ListState
              kind="empty"
              title={filter === 'all' ? 'まだ口コミがありません' : 'その状態の口コミはありません'}
              description={filter === 'all' ? '同期しても0件のときは、Google側にまだ口コミがありません。' : '絞り込みを変えると他の口コミを確認できます。'}
              emptyPreset="readonly"
            />
          </div>
        ) : null}
        {list && list.total > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <DataTable>
                <TableHeadRow>
                  <Th>投稿者・評価</Th>
                  <Th>口コミ</Th>
                  <Th>受信</Th>
                  <Th>状態</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
                {list.reviews.map((review) => {
                  const badge = replyBadge(review)
                  const actionable = review.replyStatus === 'unreplied' || review.replyStatus === 'draft' || review.replyStatus === 'pending_confirm'
                  return (
                    <Tr key={review.id}>
                      <Td>
                        <p className={styles.reviewer}>{review.reviewerDisplayName ?? '匿名'}</p>
                        <Stars rating={review.starRating} />
                      </Td>
                      <Td><p className={styles.comment} title={review.comment ?? undefined}>{review.comment ?? '（本文なし・評価のみ）'}</p></Td>
                      <Td><span className={styles.received}>{formatDateTime(review.createTime)}</span></Td>
                      <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                      <Td align="right">
                        <Button size="field" onClick={() => router.push(`/restaurant-test/google?tab=reviews&view=draft&id=${review.id}`)}>
                          {actionable ? '下書きを作る' : '返信を見る'}
                        </Button>
                      </Td>
                    </Tr>
                  )
                })}
              </DataTable>
            </div>
            <div className={styles.pager}>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          </>
        ) : null}
        <p className={styles.footNote}>返信文は手で書くか、AIで下書きを作れます。Googleへ送ると「反映確認中」になり、反映されると「返信済み」になります。</p>
      </div>
    </div>
  )
}

/**
 * フォールバック（v7 のまま出す画面）の子板の印。
 * 未接続のとき v7 は設定タブを出すので `CuHXG`。
 */
function googleFallbackNode(tab: string | null, view: string | null, connected: boolean): string {
  if (!connected) return 'CuHXG'
  if (tab === 'performance') return 'SrmVs'
  if (tab === 'profile') return 'JUTGz'
  if (tab === 'posts') return view === 'new' || view === 'edit' || view === 'confirm' ? 'T1j2Sw' : 'Cfed0'
  if (tab === 'settings') return 'CuHXG'
  if (view === 'draft') return 'x9HIR'
  return 'j0Wcg'
}

function GoogleV8Inner() {
  usePageTitle('Googleビジネス')
  const searchParams = useSearchParams()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const [data, setData] = useState<GoogleConnectionData | null>(null)
  const [stores, setStores] = useState<RestaurantStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) { setData(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const [connection, snapshot] = await Promise.all([
        restaurantGoogleApi.connection(selectedAccountId),
        restaurantTestApi.snapshot(selectedAccountId),
      ])
      setData(connection)
      setStores(snapshot.data.stores)
    } catch (err) {
      setData(null)
      setError(errorMessage(err, 'Googleビジネスの状態を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const tab = searchParams.get('tab')
  const view = searchParams.get('view')
  const connected = data?.connection.status === 'connected' || data?.connection.status === 'expired' || data?.connection.status === 'no_permission'

  if (accountLoading || loading) return <ListState kind="loading" title="Googleビジネスを読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで店舗のLINEアカウントを選ぶと表示します。' : '先にLINE公式アカウントを登録してください。'} />
  }
  if (error || !data) return <ListState kind="error" title="Googleビジネスを表示できませんでした" description={error} onRetry={() => void load()} />
  // 口コミタブ以外・下書きの画面・未接続は今の作り（v7）のまま出す。
  // 外枠に子板の印を付ける（中身の V8 化は別段）。
  if ((tab && tab !== 'reviews') || view || !connected) {
    return (
      <div data-design-node={googleFallbackNode(tab, view, connected)}>
        <GoogleBusinessPage />
      </div>
    )
  }
  return <GoogleReviewsBoard data={data} stores={stores} />
}

export default function GoogleV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <GoogleV8Inner />
    </Suspense>
  )
}
