'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantConnector, type RestaurantIntakeAddress } from '@/lib/restaurant-test-api'
import { Panel } from './shell'

type InboundEmail = {
  id: string
  storeId: string
  receivedAt: string
  status: string
  reason: string | null
  mediaCode: string | null
  mediaName: string | null
}

async function listInboundEmails(accountId: string, storeId: string): Promise<{ emails: InboundEmail[]; total: number }> {
  const res = await fetchApi<{ success: true; data: InboundEmail[]; total: number }>(
    `/api/restaurant-test/inbound-emails?account_id=${encodeURIComponent(accountId)}&storeId=${encodeURIComponent(storeId)}&status=quarantined`,
  )
  return { emails: res.data, total: res.total }
}

function formatAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 予約経路の連携タブ（hQQlt）。取り込みアドレスと媒体のつながり、読めなかったメール。 */
export default function InventoryChannels({ accountId, storeId, connectors }: {
  accountId: string
  storeId: string
  connectors: RestaurantConnector[]
}) {
  const [addresses, setAddresses] = useState<RestaurantIntakeAddress[] | null>(null)
  const [emails, setEmails] = useState<InboundEmail[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    setAddresses(null)
    setEmails(null)
    setFailed(false)
    Promise.all([
      restaurantTestApi.listIntakeAddresses(accountId, storeId),
      listInboundEmails(accountId, storeId),
    ]).then(([addrRes, mailRes]) => {
      if (!alive) return
      setAddresses(addrRes.data)
      setEmails(mailRes.emails)
      setTotal(mailRes.total)
    }).catch(() => {
      if (alive) setFailed(true)
    })
    return () => { alive = false }
  }, [accountId, storeId])

  const address = addresses?.[0]?.address ?? null
  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (failed) {
    return <ListState kind="error" description="予約経路を読み込めませんでした。" action={<Button onClick={() => window.location.reload()}>開き直す</Button>} />
  }
  if (!addresses || !emails) return <ListState kind="loading" />

  return (
    <div data-design-node="hQQlt" className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="取り込みアドレス（メール転送）" description="予約媒体から店に届く「予約のお知らせメール」を、このアドレスへ転送すると自動で台帳に入ります。">
          <p className="rounded-control border-hairline border bg-canvas-sunken px-3 py-2 font-mono text-sm">{address ?? 'まだ発行されていません'}</p>
          <div className="mt-3 flex gap-2">
            {address ? <Button size="compact" onClick={() => void copy()}>{copied ? '写しました' : 'コピー'}</Button> : null}
            <Button size="compact" href="/restaurant-test/reservations">試しに受け取る</Button>
          </div>
        </Panel>
        <Panel title="読めなかったもの" description="形が変わったメールや、店の情報と合わないメールは、捨てずにここに残ります。">
          {emails.length === 0 ? (
            <p className="text-sm text-ink-secondary">いま残っているものはありません。</p>
          ) : (
            <>
              <p className="text-sm text-ink">読めなかったものが {total} 件あります。</p>
              <ul className="mt-2 grid gap-2">
                {emails.slice(0, 3).map((mail) => (
                  <li key={mail.id} className="text-sm">
                    <span className="font-semibold text-ink">{mail.mediaName ?? mail.mediaCode ?? '媒体不明'}</span>
                    <span className="ml-2 text-xs text-ink-secondary">{formatAt(mail.receivedAt)}・{mail.reason ?? '理由不明'}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button size="compact" href="/restaurant-test/reservations">台帳で手で直して取り込む</Button>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel title="予約経路" description="媒体ごとのつながりと、最後の同期です。">
        {connectors.length === 0 ? (
          <p className="text-sm text-ink-secondary">つないでいる媒体はまだありません。</p>
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th>媒体</Th>
                <Th>受け取り方</Th>
                <Th>状態</Th>
                <Th>最後の同期</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {connectors.map((connector) => (
                <Tr key={connector.id}>
                  <Td>{connector.provider}</Td>
                  <Td>{connector.mode === 'inbound_only' ? 'メール転送（自動）' : '—'}</Td>
                  <Td>
                    <Chip tone={connector.status === 'active' ? 'ok' : 'neutral'}>{connector.status}</Chip>
                  </Td>
                  <Td>{formatAt(connector.last_synced_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
      <NoteBar tone="info">検証環境は受信専用です。外部への書き戻しはしません。</NoteBar>
    </div>
  )
}
