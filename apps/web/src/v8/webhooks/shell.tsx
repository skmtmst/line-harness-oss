'use client'

/*
 * ★V8 外部連携の外枠（Pencil「★V8 画面の地図」の外部連携の行）。
 * 板：送る `ZSbFY`・1152 `AsfFB`・閲覧のみ `l5SRfT`・受け取る `gW0F2`・
 * Google Sheets `DxAAA`・やり取りの記録 `Uv9AA`・見本 `SAUCs`。
 *
 * どのタブも「題・説明・右上の操作 → タブ（件数つき）→ 数の帯」が同じ。
 * 枠と見出しは型（ListPage）が持つ。ここはタブと帯の中身と、帯の数を読む口だけ。
 * v7 の画面（app/webhooks/page.tsx ほか）は触らない。データの口は同じ。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, Inbox, ListChecks, Send, TriangleAlert } from 'lucide-react'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { api, type OutgoingWebhookOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { Tabs } from '@/components/shared/tabs'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { formatNumber } from '@/lib/format'
import styles from './shell.module.css'

export type WebhookTabKey = 'outgoing' | 'incoming' | 'api-tokens' | 'sheets' | 'interactions' | 'notify'
export type LoadStatus = 'loading' | 'ready' | 'error'

/** 見本タブに並べる見本の数（受け取る5＋送る4）。samples.tsx の見本と同じ数。 */
export const SAMPLE_COUNT = 9

/** 外部連携の説明（全タブ共通の題の下）。 */
export const WEBHOOKS_DESCRIPTION = 'ほかのシステムと、友だちの動きをやり取りします。送る・受け取る・API・Google Sheets をここで決めます。'

/** 変更は統括だけ（v7 と同じ R32）。見るだけの人への一言。 */
export const MANAGE_REASON = '統括だけが変更できます。必要なときは統括に頼んでください。'

/*
 * タブ（絵の並び）。行き先は今と同じ ?tab=。送るタブだけ素の /webhooks（今と同じ）。
 * 件数は読めたときだけ付ける（読めないときは数を出さない）。
 */
export function WebhookTabs({ active, outgoingCount, incomingCount }: {
  active: WebhookTabKey
  outgoingCount: number | null
  incomingCount: number | null
}) {
  const label = (base: string, count: number | null) => (count === null ? base : `${base} ${count}`)
  const items: Array<{ key: WebhookTabKey; label: string }> = [
    { key: 'outgoing', label: label('こちらから送る', outgoingCount) },
    { key: 'incoming', label: label('こちらで受け取る', incomingCount) },
    { key: 'api-tokens', label: 'API 接続' },
    { key: 'sheets', label: 'Google Sheets' },
    { key: 'interactions', label: 'やり取りの記録' },
    { key: 'notify', label: `見本 ${SAMPLE_COUNT}` },
  ]
  return (
    <div className={styles.tabs}>
    <Tabs
      label="外部連携の種類"
      items={items.map((item) => ({
        label: item.label,
        href: item.key === 'outgoing' ? '/webhooks' : `/webhooks?tab=${item.key}`,
        current: item.key === active,
      }))}
    />
    </div>
  )
}

/*
 * 帯の数を読む口（送り先の一覧・受け取り口の一覧・この30日のやり取りの集計）。
 * どのタブでも同じ帯を出すので、ここで1回読む。読めない数は null（「—」と出す。0にしない）。
 */
export function useWebhookOverview() {
  const { selectedAccountId } = useAccount()
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const generationRef = useRef(0)
  const [outgoing, setOutgoing] = useState<OutgoingWebhookOverview[]>([])
  const [outgoingStatus, setOutgoingStatus] = useState<LoadStatus>('loading')
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [incomingStatus, setIncomingStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<WebhookInteractionSummary | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    const accountId = selectedAccountId
    setLoadedAccountId(null)
    if (!accountId) {
      setOutgoing([])
      setIncoming([])
      setSummary(null)
      setOutgoingStatus('ready')
      setIncomingStatus('ready')
      return
    }
    setOutgoingStatus('loading')
    setIncomingStatus('loading')
    const [outgoingResult, incomingResult, interactionsResult] = await Promise.allSettled([
      api.webhooks.outgoing.list(accountId),
      api.webhooks.incoming.list(accountId),
      api.webhooks.interactions.list(accountId, { periodDays: 30, page: 1, limit: 1 }),
    ])
    if (generationRef.current !== generation || accountRef.current !== accountId) return
    if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
      setOutgoing(outgoingResult.value.data)
      setOutgoingStatus('ready')
    } else {
      setOutgoing([])
      setOutgoingStatus('error')
    }
    if (incomingResult.status === 'fulfilled' && incomingResult.value.success) {
      setIncoming(incomingResult.value.data)
      setIncomingStatus('ready')
    } else {
      setIncoming([])
      setIncomingStatus('error')
    }
    setSummary(
      interactionsResult.status === 'fulfilled' && interactionsResult.value.success && interactionsResult.value.data?.summary
        ? interactionsResult.value.data.summary
        : null,
    )
    setLoadedAccountId(accountId)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  return {
    outgoing,
    outgoingStatus,
    incoming,
    incomingStatus,
    summary,
    loadedAccountId,
    reload: load,
    outgoingCount: outgoingStatus === 'ready' && selectedAccountId ? outgoing.length : null,
    incomingCount: incomingStatus === 'ready' && selectedAccountId ? incoming.length : null,
  }
}

export interface BandCell {
  key: string
  title: string
  icon: ReactNode
  value: number | null
  unit: string
  detail: ReactNode
}

/*
 * 送る・受け取る・Sheets・見本タブの帯（絵 ZSbFY）。
 * 「先月より」は先月の集計の口が無いので、今月送ったの下は成功の回数を出す。
 */
export function overviewBandCells(args: {
  outgoing: OutgoingWebhookOverview[] | null
  incomingCount: number | null
  summary: WebhookInteractionSummary | null
}): BandCell[] {
  const { outgoing, incomingCount, summary } = args
  const active = outgoing === null ? null : outgoing.filter((item) => item.isActive).length
  return [
    {
      key: 'destinations',
      title: '送り先',
      icon: <ListChecks size={13} aria-hidden="true" />,
      value: outgoing === null ? null : outgoing.length,
      unit: '件',
      detail: outgoing === null || active === null ? '読み込めませんでした' : `動いている ${active}・止めている ${outgoing.length - active}`,
    },
    {
      key: 'sent',
      title: '今月送った',
      icon: <Send size={13} aria-hidden="true" />,
      value: summary ? summary.outgoing : null,
      unit: '回',
      detail: summary ? `成功 ${formatNumber(Math.max(0, summary.outgoing - summary.outgoingFailed))}回` : '集計を読み込めませんでした',
    },
    {
      key: 'failed',
      title: '失敗',
      icon: <TriangleAlert size={13} aria-hidden="true" />,
      value: summary ? summary.failed : null,
      unit: '件',
      detail: summary ? '「やり取りの記録」からやり直せます' : '集計を読み込めませんでした',
    },
    {
      key: 'incoming',
      title: '受け取り',
      icon: <Inbox size={13} aria-hidden="true" />,
      value: incomingCount,
      unit: '件',
      detail: summary ? `今月 ${formatNumber(summary.incoming)} 回` : '集計を読み込めませんでした',
    },
  ]
}

export function WebhookBand({ cells }: { cells: BandCell[] }) {
  return (
    <div className={styles.stats}>
    <KpiBand aria-label="外部連携の数の帯">
      {cells.map((cell) => (
        <KpiCard
          key={cell.key}
          presentation="band"
          title={cell.title}
          icon={cell.icon}
          value={cell.value}
          unit={cell.value === null ? '' : cell.unit}
          detail={cell.detail}
        />
      ))}
    </KpiBand>
    </div>
  )
}

/** 閲覧のみの帯（絵 l5SRfT：タブの下・数の帯の上）。 */
export function ViewerBand() {
  return (
    <div className={styles.viewerRow}>
      <div className={styles.viewerBand} role="status">
        <Eye size={16} aria-hidden="true" />
        <span>閲覧のみで見ています。変える操作は統括に頼んでください。</span>
      </div>
    </div>
  )
}
