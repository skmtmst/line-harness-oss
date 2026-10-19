'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import Link, { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import Button from '@/components/shared/button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import EntitySelect from '@/components/shared/entity-select'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { RowMenu } from '@/components/shared/row-actions'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { ListToolbarEnd, ListToolbarFrame, ListToolbarRow } from '@/components/shared/list-toolbar'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ListPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import type { AccountStyle } from '@line-crm/shared'
import { hqStyleApi } from '@/lib/api/helpers/styles'
import { styleLabel } from '@/v8/onboarding/public/model/index'
import styles from './attention.module.css'

/*
 * 統括の「対応が要るもの」（★V8 修正案の列 VHp7p `Kyf8U`。決まり ）。
 *
 * 見る権限のあるアカウントごとに、未対応のトーク・承認待ちの予約・未払い・接続の異常・止まった配信の件数を出す。
 * 件数を押すと、そのアカウントに切り替えて受信箱・予約・配信の画面を開く。権限の無いアカウントは口が返さない（出さない）。
 * 口は組4の `GET /api/hq/style-attention`（作り中。撮影は見本）。
 */

type HqAttentionKind = 'unhandledChats' | 'pendingBookings' | 'unpaid' | 'connections' | 'stoppedDeliveries'
type HqAttentionItem = { accountId: string; name: string; style?: AccountStyle; counts: Partial<Record<string, number>>; details: Partial<Record<string, Array<{ id: string; href?: string }>>> }

const KINDS: ReadonlyArray<{ key: HqAttentionKind; label: string; href: string }> = [
  { key: 'unhandledChats', label: '未対応のトーク', href: '/chats?status=unread' },
  { key: 'pendingBookings', label: '承認待ちの予約', href: '/booking/bookings' },
  { key: 'unpaid', label: '未払い', href: '/booking/bookings' },
  { key: 'connections', label: '接続の異常', href: '/accounts' },
  { key: 'stoppedDeliveries', label: '止まった配信', href: '/broadcasts' },
]

/** 口の行き先のうち、今の画面に無い道（予約設定・LINE アカウント）は今ある画面へ読み替える。 */
function hrefOf(item: HqAttentionItem, kind: { key: HqAttentionKind; href: string }): string {
  const href = item.details[kind.key]?.[0]?.href
  if (!href || href.startsWith('/booking/settings') || href.startsWith('/line-accounts')) return kind.href
  return href
}

const count = (item: HqAttentionItem, kind: HqAttentionKind) => item.counts[kind] ?? 0
const total = (item: HqAttentionItem) => KINDS.reduce((sum, kind) => sum + count(item, kind.key), 0)

export default function HqAttentionV8() {
  usePageTitle('ホーム')
  const router = useRouter()
  const { accounts, setSelectedAccountId } = useAccount()
  const [items, setItems] = useState<HqAttentionItem[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<'all' | HqAttentionKind>('all')
  const [folder, setFolder] = useState('all')
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await hqStyleApi.attention()
      if (!res.success) throw new Error('attention failed')
      setItems(res.data.items)
    } catch (caught) {
      setError(describeApiFailure(caught, '読み込み', { scope: 'hq' }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void api.lineAccountFolders.list().then((res) => { if (res.success) setFolders(res.data.folders.map((item) => ({ id: item.id, name: item.name }))) }).catch(() => { /* フォルダが読めなくても全部は出す */ })
  }, [])

  const folderOf = (accountId: string) => (accounts.find((account) => account.id === accountId) as { folderId?: string | null } | undefined)?.folderId ?? null
  const shown = useMemo(() => (items ?? [])
    .filter((item) => (kind === 'all' ? total(item) > 0 : count(item, kind) > 0))
    .filter((item) => folder === 'all' || folderOf(item.accountId) === folder)
    .sort((a, b) => (kind === 'all' ? total(b) - total(a) : count(b, kind) - count(a, kind))),
  [items, kind, folder, accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  /* そのアカウントに切り替えてから開く。 */
  const open = (accountId: string, href: string) => {
    setSelectedAccountId(accountId)
    router.push(href)
  }

  const sum = (key: HqAttentionKind) => (items ? items.reduce((value, item) => value + count(item, key), 0) : null)
  const accountsWith = (key: HqAttentionKind) => (items ?? []).filter((item) => count(item, key) > 0)

  const stats = (
    <KpiBand>
      {KINDS.map((item) => {
        const withCount = accountsWith(item.key)
        return (
          <KpiCard
            key={item.key}
            title={item.label}
            value={sum(item.key)}
            unit="件"
            icon={null}
            loading={items === null}
            detail={withCount.length === 1 && item.key === 'connections' ? withCount[0].name : `${withCount.length} アカウント`}
          />
        )
      })}
    </KpiBand>
  )

  const toolbar = (
    <ListToolbarFrame>
      <ListToolbarRow>
        <Select aria-label="種類" value={kind} onChange={(value) => setKind(value as typeof kind)} options={[{ value: 'all', label: '種類：すべて' }, ...KINDS.map((item) => ({ value: item.key, label: `種類：${item.label}` }))]} />
        <EntitySelect compact aria-label="アカウントのフォルダ" noun="フォルダ" valuePrefix="アカウントのフォルダ：" value={folder} onChange={setFolder} options={[{ value: 'all', label: 'すべて' }, ...folders.map((item) => ({ value: item.id, label: item.name }))]} />
        <ListToolbarEnd><span className={styles.sort}>件数の多い順</span></ListToolbarEnd>
      </ListToolbarRow>
    </ListToolbarFrame>
  )

  return (
    <ListPage
      boardId="Kyf8U"
      title={<><Link href="/hq" className={styles.parent}>ホーム ›</Link>対応が要るもの</>}
      help="アカウントごとに、すぐ対応が要るものの件数を出します。件数を押すと、そのアカウントに切り替えて開きます。"
      actions={<Button onClick={() => void load()} busy={loading} busyLabel="読み直しています…"><RefreshCw aria-hidden="true" className={styles.buttonIcon} />すべて読み直す</Button>}
      stats={stats}
      toolbar={toolbar}
      tableInset
    >
      {error ? <Notice tone="danger" action={<Button onClick={() => void load()}>もう一度試す</Button>}>{error}</Notice> : null}
      <div className={styles.stack}>
      {items === null ? (error ? null : <ListState kind="loading" title="読み込んでいます…" />) : shown.length === 0 && !error ? (
        <ListState kind="empty" title="今、対応が要るものはありません" emptyPreset="readonly" />
      ) : (
        <div className={styles.table}><GridTable label="対応が要るもの" design={{ columns: 'minmax(0, 1fr) var(--hqa-col-wide) var(--hqa-col-wide) var(--hqa-col-narrow) var(--hqa-col-mid) var(--hqa-col-mid) var(--hqa-col-menu)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', rowHeight: 'var(--hqa-row-h)', fontSize: 'var(--text-body)' }}>
          <GridHeadRow>
            <GridCell role="columnheader">アカウント</GridCell>
            {KINDS.map((item) => <GridCell key={item.key} role="columnheader">{item.label}</GridCell>)}
            <GridCell role="columnheader">操作</GridCell>
          </GridHeadRow>
          {shown.map((item) => (
            <GridRow key={item.accountId}>
              <GridCell className={styles.account}>
                <span className={styles.name} title={item.name}>{item.name}</span>
                {item.style ? <span className={styles.style}>{styleLabel(item.style)}</span> : null}
              </GridCell>
              {KINDS.map((entry) => {
                const value = count(item, entry.key)
                const href = hrefOf(item, entry)
                if (value === 0) return <GridCell key={entry.key}><span className={styles.none} aria-label="なし">—</span></GridCell>
                if (entry.key === 'connections') return <GridCell key={entry.key}><button type="button" className={styles.badgeButton} onClick={() => open(item.accountId, href)}><StatusBadge tone="danger" dot>LINE の接続</StatusBadge></button></GridCell>
                return <GridCell key={entry.key}><button type="button" className={styles.count} onClick={() => open(item.accountId, href)} aria-label={`${item.name}の${entry.label} ${value}件を開く`}>{`${value} 件`}</button></GridCell>
              })}
              <GridCell>
                <RowMenu appearance="box" size="row" label={`${item.name}の操作`} items={KINDS.filter((entry) => count(item, entry.key) > 0).map((entry) => ({ id: entry.key, label: `${entry.label}を開く`, onSelect: () => open(item.accountId, hrefOf(item, entry)) }))} />
              </GridCell>
            </GridRow>
          ))}
        </GridTable></div>
      )}
      <p className={styles.help}><Info aria-hidden="true" className={styles.helpIcon} />件数を押すと、そのアカウントに切り替えて受信箱・予約・配信の画面を開きます。見る権限の無いアカウントは出しません。</p>
      </div>
    </ListPage>
  )
}
