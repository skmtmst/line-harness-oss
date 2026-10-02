'use client'

/*
 * ★V8-B 飲食店向け（テスト）の共通の器。
 *
 * Pencil「★V8-B 画面の地図」飲食店向けの行（店舗ダッシュボード CHz31 ほか）
 * が正本。どの画面も同じ形：
 *   板の頭（題・説明・右上に店舗を選ぶ欄）
 *   → 検証環境の帯（予約媒体は受信専用・外部更新なし）
 *   → 中身（数の並び・白い枠・表）
 *
 * v7 の器（restaurant-console.tsx）は無変更で残す。データの口は同じ
 * restaurantTestApi.snapshot を使い、ここでは取得と置き場だけを持つ。
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

const statusLabel: Record<string, string> = {
  connected: '正常', active: '有効', invited: '招待中', suspended: '停止中', archived: '保管済', approved: '承認済', completed: '完了', visited: '来店済',
  confirmed: '予約確定', warning: '要確認', pending: '承認待ち', draft: '下書き', scheduled: '予約済',
  unreplied: '未返信', unconfigured: '未設定', disabled: '無効', error: 'エラー', returned: '差戻し',
  seated: '来店中', cancelled: '取消', no_show: '無断キャンセル', preview_only: 'プレビューのみ',
}

/** 板の「状態の札」（点＋文字）。共通の StatusBadge を v8 の見た目で使う。 */
export function Status({ value }: { value: string }) {
  const tone: StatusBadgeTone =
    ['connected', 'active', 'approved', 'completed', 'visited', 'confirmed'].includes(value) ? 'success'
      : ['warning', 'pending', 'draft', 'scheduled', 'unreplied', 'returned'].includes(value) ? 'warning'
        : ['error', 'no_show', 'cancelled'].includes(value) ? 'danger'
          : 'neutral'
  return <StatusBadge tone={tone}>{statusLabel[value] || value}</StatusBadge>
}

/** 検証環境の帯（CHz31「検証環境の帯」）。全画面で同じ。 */
export function BoundaryBanner() {
  return (
    <div className={styles.boundary}>
      <span className={styles.boundaryBadge}>検証環境専用</span>
      <p className={styles.boundaryText}>既存の然-NEN運用とは分離された飲食店向けテスト領域です。</p>
      <span className={styles.boundaryNote}>予約媒体は受信専用・外部更新なし</span>
    </div>
  )
}

/** 数のカード（CHz31「数の並び」）。 */
export function Stat({ label, value, note, warning = false, helpLabel, help }: {
  label: string
  value: ReactNode
  note: string
  /** 注意を促す数（未返信口コミなど）は琥珀色で出す。 */
  warning?: boolean
  helpLabel?: string
  help?: ReactNode
}) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>
        {label}
        {help ? <HelpTip label={helpLabel ?? `${label}の説明`}>{help}</HelpTip> : null}
      </p>
      <p className={`${styles.statValue} ${warning ? styles.statValueWarning : ''}`}>{value}</p>
      <p className={styles.statNote}>{note}</p>
    </div>
  )
}

/** 白い枠（CHz31「枠 店舗一覧」）。題・説明・右端の注意を持つ。 */
export function Panel({ title, description, aside, flush = false, children, className = '' }: {
  title: string
  description?: string
  /** 頭の右端に出す短い文（「2件の要確認」など）。 */
  aside?: ReactNode
  /** 表など枠いっぱいの中身のとき true（内側の余白を付けない）。 */
  flush?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
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

export function PanelAside({ tone = 'warning', children }: { tone?: 'warning' | 'success'; children: ReactNode }) {
  return <span className={`${styles.panelAside} ${tone === 'success' ? styles.panelAsideOk : ''}`}>{children}</span>
}

/** 「店舗が登録されていません」の1枚（v7 の EmptySetup と同じ意味）。 */
function EmptySetup() {
  return (
    <div className={styles.panel}>
      <div className={styles.stateBox}>
        <ListState kind="empty" title="店舗が登録されていません" description="統括から店舗を登録してください。" />
      </div>
    </div>
  )
}

export default function RestaurantShell({ boardId, title, description, query, children }: {
  /** Pencil の板 ID（例 `CHz31`）。外枠へ付ける。 */
  boardId: string
  title: string
  description: string
  /** 台帳系の画面が渡す絞り込み。ダッシュボードは「今日以降の有効予約」。 */
  query?: ReservationQuery
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
  /* v7（D024）と同じ決まり：取得失敗と未登録を混ぜない。 */
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setSnapshot(null); setLoadError(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await restaurantTestApi.snapshot(selectedAccountId, query)
      setSnapshot(res.data)
      setLoadError(null)
      setSelectedStoreId((current) => res.data.stores.some((item) => item.id === current)
        ? current
        : res.data.stores[0]?.id || '')
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
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : '保存できませんでした。',
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

  return (
    <div data-design-node={boardId}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>{title}</h1>
          <p className={styles.headDescription}>{description}</p>
        </div>
        {snapshot && snapshot.stores.length > 0 ? (
          <Select
            aria-label="店舗を選ぶ"
            className={styles.storePicker}
            value={selectedStoreId}
            onChange={setSelectedStoreId}
            options={snapshot.stores.map((item) => ({ value: item.id, label: `店舗：${item.name}` }))}
          />
        ) : null}
      </div>
      <div className={styles.body}>
        <BoundaryBanner />
        {notice ? (
          <div role="status" className={`${styles.notice} ${notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError}`}>
            {notice.text}
          </div>
        ) : null}
        {loading ? (
          <div className={styles.panel}><div className={styles.stateBox}><ListState kind="loading" /></div></div>
        ) : loadError !== null && !snapshot?.organization ? (
          <ListState kind="error" error={loadError} onRetry={() => void load()} />
        ) : !snapshot?.organization ? (
          <EmptySetup />
        ) : (
          children({ data: snapshot, store, selectedStoreId, busy, mutate, reload: load })
        )}
      </div>
    </div>
  )
}
