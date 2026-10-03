'use client'

/*
 * ★V8-B 外部連携の外枠。タブは道をまたがない（送る・受け取る・
 * API 接続・Google Sheets・やり取りの記録・見本）。
 * 件数はそのタブの一覧と同じ取得から数える（#980）。
 * v7 の器（`page.tsx`）とは別の器。
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import styles from './webhooks-v8-shell.module.css'
import V8OutgoingTab from './webhooks-v8-outgoing'

export type WebhooksV8TabKey = 'outgoing' | 'incoming' | 'api-tokens' | 'sheets' | 'interactions' | 'notify'

const TABS: Array<{ key: WebhooksV8TabKey; label: string; node: string }> = [
  { key: 'outgoing', label: 'こちらから送る', node: 'ZSbFY' },
  { key: 'incoming', label: 'こちらで受け取る', node: 'gW0F2' },
  { key: 'api-tokens', label: 'API 接続', node: 'ralAc' },
  { key: 'sheets', label: 'Google Sheets', node: 'DxAAA' },
  { key: 'interactions', label: 'やり取りの記録', node: 'Uv9AA' },
  { key: 'notify', label: '見本', node: 'ZSbFY' },
]

export function webhooksV8Node(tab: WebhooksV8TabKey): string {
  return TABS.find((item) => item.key === tab)?.node ?? 'ZSbFY'
}

/*
 * ★V8-B 外部連携の外枠。中身のタブはこの器が ?tab= で切り替えて描く。
 * page.tsx の V8 の枝はこの器を置くだけ。
 */
export function WebhooksV8Shell() {
  usePageTitle('外部連携')
  const { selectedAccountId } = useAccount()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: WebhooksV8TabKey = TABS.some((item) => item.key === rawTab)
    ? (rawTab as WebhooksV8TabKey)
    : 'outgoing'
  const [outgoingCount, setOutgoingCount] = useState<number | null>(null)
  const [incomingCount, setIncomingCount] = useState<number | null>(null)
  /*
   * 受け取り口・送り先の作成は統括だけ（v7 の R32 と同じ）。
   * 確認が終わるまでは操作を出し、終わって統括でなければ案内に替える。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const readonly = staffRole !== null && staffRole !== 'owner'

  /*
   * 件数はそのタブの一覧と同じ取得から数える（#980）。
   * 外枠は取らず、各タブが読み終わりに報告する。
   */
  useEffect(() => {
    if (!selectedAccountId) {
      setOutgoingCount(null)
      setIncomingCount(null)
    }
  }, [selectedAccountId])

  // 見本の件数は `page.tsx` の見本データ（受け取る5＋送る4）と同じ数。
  const samplesCount = 9
  const countOf = (key: WebhooksV8TabKey): string => {
    if (key === 'outgoing') return outgoingCount === null ? '' : ` ${outgoingCount}`
    if (key === 'incoming') return incomingCount === null ? '' : ` ${incomingCount}`
    if (key === 'notify') return ` ${samplesCount}`
    return ''
  }

  return (
    <div data-design-node={webhooksV8Node(tab)} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>外部連携</h1>
          <p className={styles.headDescription}>
            ほかのシステムと、友だちの動きをやり取りします。送る・受け取る・API・Google Sheets をここで決めます。
          </p>
        </div>
        {readonly ? (
          <Button type="button" variant="secondary" disabled title="閲覧のみのため作れません">
            見本から作る
          </Button>
        ) : (
          <Button variant="secondary" href="/webhooks?tab=notify">
            見本から作る
          </Button>
        )}
      </div>
      <nav className={styles.tabs} aria-label="外部連携の種類">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={`/webhooks?tab=${item.key}`}
            aria-current={tab === item.key ? 'page' : undefined}
            className={item.key === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {item.label}{countOf(item.key)}
          </Link>
        ))}
      </nav>
      {tab === 'outgoing' ? <V8OutgoingTab onCounts={setOutgoingCount} /> : null}
    </div>
  )
}
