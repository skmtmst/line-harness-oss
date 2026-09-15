'use client'

import type { AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { TableHeadRow, Th } from '@/components/shared/table'

export function accountIconUrl(account: AccountWithStats): string | null {
  return account.pictureUrl || account.iconUrl || null
}

function AccountIcon({ account }: { account: AccountWithStats }) {
  const src = accountIconUrl(account)
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  const label = (account.displayName || account.name).trim().slice(0, 1)
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{label}</span>
}

function ConnectionStatus({ status }: { status: 'ok' | 'warn' | 'unknown' | undefined }) {
  const tone: StatusBadgeTone = status === 'ok' ? 'success' : status === 'warn' ? 'warning' : 'neutral'
  const label = status === 'ok' ? '正常' : status === 'warn' ? '要確認' : '未確認'
  return <StatusBadge tone={tone} size="compact">{label}</StatusBadge>
}

export default function HqAccountList({
  accounts,
  onSelect,
  onSettings,
  selectLabel = 'ログイン',
}: {
  accounts: AccountWithStats[]
  onSelect: (accountId: string) => void
  onSettings?: (account: AccountWithStats) => void
  selectLabel?: string
}) {
  return (
    <section data-design="List" data-design-node="vLMQ5" className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-max text-left">
          <thead>
            <TableHeadRow>
              <Th>アカウント</Th>
              <Th align="right">友だち数</Th>
              <Th align="right">今月の配信数</Th>
              <Th>接続状態</Th>
              <Th align="right">担当者数</Th>
              <Th>状態</Th>
              <Th align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody className="divide-y divide-hairline">
            {accounts.map((account) => (
              <tr key={account.id} className="h-16 hover:bg-canvas-sunken">
                <td className="px-5 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountIcon account={account} />
                    <div className="min-w-0">
                      <p className="max-w-72 truncate text-sm font-semibold text-ink" title={account.displayName || account.name}>{account.displayName || account.name}</p>
                      <p className="mt-0.5 max-w-72 truncate text-xs text-ink-faint" title={account.basicId || ''}>{account.basicId || '—'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums text-ink">{(account.stats?.friendCount ?? 0).toLocaleString('ja-JP')}</td>
                <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums text-ink">{(account.stats?.messagesThisMonth ?? 0).toLocaleString('ja-JP')}</td>
                <td className="px-4 py-2"><ConnectionStatus status={account.connection?.status} /></td>
                <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums text-ink">{(account.stats?.staffCount ?? 0).toLocaleString('ja-JP')}人</td>
                <td className="px-4 py-2"><StatusBadge tone={account.isActive ? 'success' : 'neutral'} size="compact">{account.isActive ? '有効' : '停止中'}</StatusBadge></td>
                <td className="px-5 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {onSettings ? <Button type="button" variant="secondary" onClick={() => onSettings(account)}>設定</Button> : null}
                    <Button type="button" variant="primary" onClick={() => onSelect(account.id)}>{selectLabel}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
