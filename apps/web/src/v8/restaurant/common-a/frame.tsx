'use client'

/*
 * ★V8 飲食店向け（テスト）の器（担当 a：ダッシュボード・承認・組織・LINE来店フォロー・Googleビジネス）。
 *
 * Pencil の飲食店向けの板（店舗ダッシュボード CHz31 ほか）は、どれも同じ形：
 *   板の頭（題 22/32・説明 13/19・右上に店舗を選ぶ欄 210×36）
 *   → 中身（上16・左右24・下24、段の間16）：検証環境の帯 → 板ごとの中身。
 * 板の頭の寸法は型（PageFrame・PageHeading）が持つ。ここは取得と置き場だけ。
 *
 * データの口は今の画面（app/restaurant-test/v8/shell.tsx）と同じ
 * restaurantTestApi.snapshot。取得失敗と未登録を混ぜない（D024）。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import {
  restaurantTestApi,
  type ReservationQuery,
  type RestaurantSnapshot,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import styles from './frame.module.css'

export interface RestaurantContext {
  data: RestaurantSnapshot
  /** 店舗を選ぶ欄で今選んでいる店舗（「すべての店舗」のときは null）。 */
  store: RestaurantStore | null
  selectedStoreId: string
  busy: boolean
  /** 書き込みの共通処理。成功したら取り直して帯を出す。 */
  mutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>
  reload: () => Promise<void>
}

/** 店舗を選ぶ欄（絵の「選ぶ欄」：幅210・高さ36）。 */
export const STORE_PICKER_WIDTH = 210

/** 検証環境の帯（CHz31「検証環境の帯」）。右の注意は板ごとに替えられる。 */
export function BoundaryBanner({ note = '予約媒体は受信専用・外部更新なし' }: { note?: string }) {
  return (
    <div className={styles.boundary}>
      <span className={styles.boundaryBadge}>検証環境専用</span>
      <p className={styles.boundaryText}>既存の然-NEN運用とは分離された飲食店向けテスト領域です。</p>
      <span className={styles.boundarySpacer} aria-hidden="true" />
      <span className={styles.boundaryDot} aria-hidden="true" />
      <span className={styles.boundaryNote}>{note}</span>
    </div>
  )
}

/** 板の頭と中身の並び（取得を持たない画面でも使う）。 */
export function RestaurantPage({ boardId, title, description, picker, children }: {
  boardId: string
  title: string
  description: string
  picker?: ReactNode
  children: ReactNode
}) {
  return (
    <PageFrame kind="list" boardId={boardId}>
      <PageHeading title={title} description={description} actions={picker} />
      <div className={styles.body}>{children}</div>
    </PageFrame>
  )
}

export default function RestaurantFrame({
  boardId,
  title,
  description,
  query,
  allStores = false,
  bannerNote,
  children,
}: {
  /** Pencil の板 ID（例 `CHz31`）。外枠へ付ける。 */
  boardId: string
  title: string
  description: string
  /** 台帳の画面が渡す絞り込み。ダッシュボードは「今日以降の有効予約」。 */
  query?: ReservationQuery
  /** 店舗を選ぶ欄の先頭に「すべての店舗」を足す（全店を見る画面）。 */
  allStores?: boolean
  bannerNote?: string
  children: (ctx: RestaurantContext) => ReactNode
}) {
  usePageTitle(title)
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId } = useAccount()
  const [snapshot, setSnapshot] = useState<RestaurantSnapshot | null>(null)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setSnapshot(null); setLoadError(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await restaurantTestApi.snapshot(selectedAccountId, query)
      setSnapshot(res.data)
      setLoadError(null)
      setSelectedStoreId((current) => (allStores && current === '') || res.data.stores.some((item) => item.id === current)
        ? current
        : res.data.stores[0]?.id || '')
    } catch (caught) {
      setLoadError(caught)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, query, allStores])
  useEffect(() => { void load() }, [load])

  const mutate = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      await load()
      setNotice({ tone: 'success', text: success })
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof ApiError ? error.message : '保存できませんでした。' })
      return false
    } finally {
      setBusy(false)
    }
  }, [load])

  const store = useMemo(
    () => (selectedStoreId ? snapshot?.stores.find((item) => item.id === selectedStoreId) || null : null),
    [snapshot, selectedStoreId],
  )

  const picker = snapshot && snapshot.stores.length > 0 ? (
    <Select
      aria-label="店舗を選ぶ"
      width={STORE_PICKER_WIDTH}
      value={selectedStoreId}
      onChange={setSelectedStoreId}
      options={[
        ...(allStores ? [{ value: '', label: '店舗：すべての店舗' }] : []),
        ...snapshot.stores.map((item) => ({ value: item.id, label: `店舗：${item.name}` })),
      ]}
    />
  ) : null

  return (
    <RestaurantPage boardId={boardId} title={title} description={description} picker={picker}>
      <BoundaryBanner note={bannerNote} />
      {notice ? (
        <div role="status" className={`${styles.notice} ${notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError}`}>
          {notice.text}
        </div>
      ) : null}
      {loading ? (
        <div className={styles.stateBox}><ListState kind="loading" /></div>
      ) : loadError !== null && !snapshot?.organization ? (
        <ListState kind="error" error={loadError} onRetry={() => void load()} />
      ) : !snapshot?.organization ? (
        <div className={styles.stateBox}>
          <ListState kind="empty" title="店舗が登録されていません" description="統括から店舗を登録してください。" />
        </div>
      ) : (
        children({ data: snapshot, store, selectedStoreId, busy, mutate, reload: load })
      )}
    </RestaurantPage>
  )
}
