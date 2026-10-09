'use client'

import { useSamePageUrl } from '@/lib/use-same-page-url'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Copy, GitBranch, QrCode } from 'lucide-react'
import type { EntryRoute } from '@line-crm/shared'
import { api, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SectionHeader from './head'
import QrDialog from '@/components/dashboard/qr-dialog'
import styles from './dashboard.module.css'

/*
 * 友だち追加リンク（WQmep 段C）。動きは v7 の FriendAddLinkCard と同じ：
 * - 経路は選択中アカウントの有効なものだけ（DASH-09）
 * - QR の表示は URL に残す（`?qr=base` / `?qr=<経路ID>`）
 * - コピーに失敗したら黙らず、欄から選べることを伝える（DASH-29）
 * 閲覧のみの人には「経路を分けて発行」（作る操作）を出さない。
 */
export function FriendAddLink({ officialProfileUrl, visualQa, canManage }: {
  officialProfileUrl: string | null | undefined
  visualQa?: DashboardOverview['visualQa']
  canManage: boolean
}) {
  const { selectedAccount, selectedAccountId } = useAccount()
  const samePageUrl = useSamePageUrl()
  const params = useSearchParams()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [routes, setRoutes] = useState<EntryRoute[] | null>(null)
  const [routeId, setRouteId] = useState('')
  const qrParam = params.get('qr')
  const [showQr, setShowQr] = useState(() => qrParam !== null)
  const [qrRouteId, setQrRouteId] = useState(() => (qrParam !== null && qrParam !== 'base' ? qrParam : ''))
  useEffect(() => {
    setShowQr(qrParam !== null)
    setQrRouteId(qrParam !== null && qrParam !== 'base' ? qrParam : '')
  }, [qrParam])
  const writeQr = (value: string | null) => {
    setShowQr(value !== null)
    setQrRouteId(value !== null && value !== 'base' ? value : '')
    const next = new URLSearchParams(params.toString())
    if (value === null) next.delete('qr')
    else next.set('qr', value)
    const text = next.toString()
    samePageUrl.replace(text ? `/?${text}` : '/')
  }

  useEffect(() => {
    let cancelled = false
    setRoutes(null)
    setRouteId('')
    if (!selectedAccountId) return () => { cancelled = true }
    void api.entryRoutes.list(selectedAccountId)
      .then((res) => {
        if (!cancelled) setRoutes(res.success ? res.data.filter((route) => route.isActive) : [])
      })
      .catch(() => { if (!cancelled) setRoutes([]) })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const baseLink = visualQa?.friendAddUrl ?? (selectedAccount
    ? `${base}/auth/line?account=${encodeURIComponent(selectedAccount.channelId)}`
    : `${base}/auth/line`)
  const route = (routes ?? []).find((entry) => entry.id === routeId)
  const link = route ? `${base}/r/${route.refCode}` : baseLink

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1200)
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <>
      <SectionHeader
        title="友だち追加リンク"
        help="このURLから追加された友だちは、流入元を記録して計測できます。"
        helpLabel="友だち追加リンクの説明"
      />
      <div className={styles.linkRow}>
        <span className={styles.linkKey}>発行中</span>
        <span className={styles.routeSelect}>
          <Select
            value={routeId}
            onChange={(value) => setRouteId(value)}
            aria-label="発行中の追加URL"
            options={[
              { value: '', label: '基本の追加URL' },
              ...(routes ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
          />
        </span>
        <span className={styles.spacer} />
        {canManage ? (
          <Button href="/inflow-links"><GitBranch size={15} aria-hidden="true" />経路を分けて発行</Button>
        ) : null}
      </div>
      <div className={styles.linkRow}>
        <input
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="友だち追加リンク"
          className={styles.urlField}
        />
        <Button type="button" onClick={onCopy}>
          <Copy size={15} aria-hidden="true" />{copyState === 'copied' ? 'コピーしました' : 'コピー'}
        </Button>
        <Button type="button" onClick={() => writeQr(routeId || 'base')}>
          <QrCode size={15} aria-hidden="true" />QRを表示
        </Button>
      </div>
      {copyState === 'failed' ? (
        <p role="alert" className={styles.alert}>コピーできませんでした。上のURL欄を選択してコピーしてください。</p>
      ) : null}
      <QrDialog
        open={showQr}
        onClose={() => writeQr(null)}
        accountName={selectedAccount?.displayName ?? 'LINE公式アカウント'}
        officialProfileUrl={visualQa?.officialProfileUrl ?? officialProfileUrl}
        accountBasicId={selectedAccount?.basicId ?? null}
        baseLink={baseLink}
        initialRouteId={showQr ? qrRouteId : routeId}
        onRouteIdChange={(id) => writeQr(id || 'base')}
        routes={routes ?? []}
        routesPending={routes === null}
        visualReferenceQr={visualQa?.referenceQr ?? false}
      />
    </>
  )
}
