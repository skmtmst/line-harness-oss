'use client'

/*
 * ★V8 飲食店向け（テスト）の器 — 在庫・予約台帳・座席・メニューの4画面用。
 *
 * 板の頭（題・説明・右上に店舗を選ぶ欄）→ 検証環境の帯 → 中身。
 * 寸法は Pencil の板（メニュー管理 MJoJR ほか）の書き出しから読む。
 * データの口は今の画面（app/restaurant-test/v8/shell.tsx）と同じ
 * restaurantTestApi.snapshot。src/v8 は古い画面を import できないので写した。
 */
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import {
  restaurantTestApi,
  type ReservationQuery,
  type RestaurantSnapshot,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import StoreTabs, { type StoreTabKey } from '../store-tabs/store-tabs'
import styles from './shell.module.css'

export interface RestaurantV8Context {
  data: RestaurantSnapshot
  /** 店舗を選ぶ欄で今選んでいる店舗（先頭が既定）。 */
  store: RestaurantStore | null
  selectedStoreId: string
  busy: boolean
  /** 書き込み操作の共通処理。成功したら取り直して帯を出す。 */
  mutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>
  reload: () => Promise<void>
}

/**
 * 帯を出さずに失敗として返すときの印。画面が自分で知らせ方を持つとき
 * （競合の帯など）に投げる。mutate は false を返すだけで、上の帯は出さない。
 */
export class QuietError extends Error {}

const statusLabel: Record<string, string> = {
  connected: '正常', active: '有効', invited: '招待中', suspended: '停止中', archived: '保管済', approved: '承認済', completed: '完了', visited: '来店済',
  confirmed: '予約確定', warning: '要確認', pending: '承認待ち', draft: '下書き', scheduled: '予約済', paused: '停止中',
  unreplied: '未返信', unconfigured: '未設定', disabled: '無効', error: 'エラー', returned: '差戻し',
  seated: '来店中', cancelled: '取消', no_show: '無断キャンセル', preview_only: 'プレビューのみ',
}

export function statusTone(value: string): StatusBadgeTone {
  return ['connected', 'active', 'approved', 'completed', 'visited', 'confirmed', 'seated'].includes(value) ? 'success'
    : ['warning', 'pending', 'draft', 'scheduled', 'unreplied', 'returned'].includes(value) ? 'warning'
      : ['error', 'no_show'].includes(value) ? 'danger'
        : 'neutral'
}

/** 状態の札（点＋文字）。共通の StatusBadge を絵の寸法で使う。 */
export function Status({ value, label }: { value: string; label?: string }) {
  return <StatusBadge tone={statusTone(value)} className={styles.status}>{label ?? statusLabel[value] ?? value}</StatusBadge>
}

/** 検証環境の帯。全画面で同じ。 */
export function BoundaryBanner() {
  return (
    <div className={styles.boundary}>
      <span className={styles.boundaryBadge}>検証環境専用</span>
      <p className={styles.boundaryText}>既存の然-NEN運用とは分離された飲食店向けテスト領域です。</p>
      <span className={styles.boundaryNote}>予約媒体は受信専用・外部更新なし</span>
    </div>
  )
}

/** 数のカード。並べるときは StatRow で包む。 */
export function Stat({ label, value, note, warning = false, help }: {
  label: string
  value: ReactNode
  note: string
  /** 注意を促す数（要承認・未配席など）は琥珀色で出す。 */
  warning?: boolean
  help?: ReactNode
}) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>
        {label}
        {help ? <HelpTip label={`${label}の説明`}>{help}</HelpTip> : null}
      </p>
      <p className={`${styles.statValue} ${warning ? styles.statValueWarning : ''} ${typeof value === 'string' && /[^\x20-\x7e]/.test(value) ? styles.statValueJp : ''}`}>{value}</p>
      <p className={styles.statNote}>{note}</p>
    </div>
  )
}

/** 数の並び。compact は予約台帳の今日（内側14・数字20）。 */
export function StatRow({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`${styles.stats} ${compact ? styles.statsCompact : ''}`}>{children}</div>
}

/** 白い枠。題・説明・右端の操作を持つ。 */
export function Panel({ title, description, aside, flush = false, children }: {
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  /** 表など枠いっぱいの中身のとき true（内側の余白を付けない）。 */
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 className={styles.panelTitle}>{title}</h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {aside}
      </div>
      {flush ? children : <div className={styles.panelBody}>{children}</div>}
    </section>
  )
}

function EmptySetup() {
  return (
    <div className={styles.panel}>
      <div className={styles.stateBox}>
        <ListState kind="empty" title="店舗が登録されていません" description="統括から店舗を登録してください。" />
      </div>
    </div>
  )
}

export default function RestaurantShell({ boardId, title, description, query, headAfter, bare = false, layout = 'standard', storeTab, children }: {
  /** Pencil の板 ID。外枠へ付ける。 */
  boardId: string
  title: string
  description: string
  query?: ReservationQuery
  /**
   * 板の頭の右に置く物（予約台帳の見方の切り替え・主ボタンなど）。店舗を選ぶ欄は2つ目の引数で渡すので、
   * 並べる場所は画面が決める（予約台帳は狭い幅で欄ごと2行目へ折り返す）。
   */
  headAfter?: (ctx: RestaurantV8Context | null, storePicker: ReactNode) => ReactNode
  /** 板の頭と検証環境の帯を出さない（電話の予約を入れる rm92Y のように画面が自分の頭を持つとき）。 */
  bare?: boolean
  /**
   * 画面ごとの寸法の違い。ledger＝予約台帳（頭が狭い幅で2行に折り返す・店舗の欄が 180）、
   * ledgerTight＝予約台帳の今日（さらに段の間が 14）。
   */
  layout?: 'standard' | 'ledger' | 'ledgerTight'
  /** 板の頭の下に店のタブ（提案 E-1：ダッシュボード・予約・座席・卓・予約枠・在庫）を出す。今の画面の印。 */
  storeTab?: StoreTabKey
  children: (ctx: RestaurantV8Context) => ReactNode
}) {
  usePageTitle(title)
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId } = useAccount()
  const [snapshot, setSnapshot] = useState<RestaurantSnapshot | null>(null)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  /* 取得失敗と未登録を混ぜない（今の画面と同じ決まり）。 */
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setSnapshot(null); setLoadError(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await restaurantTestApi.snapshot(selectedAccountId, query)
      setSnapshot(res.data)
      setLoadError(null)
      setSelectedStoreId((current) => (res.data.stores.some((item) => item.id === current)
        ? current
        : res.data.stores[0]?.id || ''))
    } catch (caught) {
      setLoadError(caught)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, query])
  useEffect(() => { void load() }, [load])

  const mutate = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      await load()
      setNotice({ tone: 'success', text: success })
      return true
    } catch (error) {
      if (error instanceof QuietError) { setNotice(null); return false }
      setNotice({
        tone: 'error',
        text: error instanceof ApiError || error instanceof Error ? error.message : '保存できませんでした。',
      })
      return false
    } finally {
      setBusy(false)
    }
  }, [load])

  const store = useMemo(
    () => (selectedStoreId ? snapshot?.stores.find((item) => item.id === selectedStoreId) || null : null),
    [snapshot, selectedStoreId],
  )
  const ctx: RestaurantV8Context | null = snapshot?.organization
    ? { data: snapshot, store, selectedStoreId, busy, mutate, reload: load }
    : null

  const content = loading && !snapshot ? (
    <div className={styles.panel}><div className={styles.stateBox}><ListState kind="loading" /></div></div>
  ) : loadError !== null && !snapshot?.organization ? (
    <ListState kind="error" error={loadError} onRetry={() => void load()} />
  ) : !ctx ? (
    <EmptySetup />
  ) : (
    children(ctx)
  )
  const storePicker = snapshot && snapshot.stores.length > 0 ? (
    <span className={`${styles.storePicker} ${layout === 'standard' ? '' : styles.storeLedger}`}>
      <Select
        aria-label="店舗を選ぶ"
        size="full"
        value={selectedStoreId}
        onChange={setSelectedStoreId}
        options={snapshot.stores.map((item) => ({ value: item.id, label: `店舗：${item.name}` }))}
      />
    </span>
  ) : null
  const noticeBand = notice ? (
    <div role="status" className={`${styles.notice} ${notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError}`}>
      {notice.text}
    </div>
  ) : null

  if (bare) {
    return (
      <div data-design-node={boardId} className={styles.page}>
        {noticeBand}
        {content}
      </div>
    )
  }

  return (
    <div data-design-node={boardId} className={styles.page}>
      <div className={`${styles.head} ${layout === 'standard' ? '' : styles.headLedger}`}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>{title}</h1>
          <p className={styles.headDescription}>{description}</p>
        </div>
        {headAfter ? headAfter(ctx, storePicker) : storePicker}
      </div>
      {storeTab ? <StoreTabs current={storeTab} flush /> : null}
      <div className={`${styles.body} ${layout === 'ledgerTight' ? styles.bodyTight : ''}`}>
        <BoundaryBanner />
        {noticeBand}
        {content}
      </div>
    </div>
  )
}
