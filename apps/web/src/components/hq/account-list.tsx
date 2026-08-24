'use client'

import type { AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import { TableHeadRow, Th } from '@/components/shared/table'

function AccountIcon({ account }: { account: AccountWithStats }) {
  if (account.pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={account.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-control object-cover" />
  }
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-sm font-bold text-accent">然</span>
}

function WebhookStatus({ status }: { status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown' | undefined }) {
  if (status === 'matched') return <span className="text-sm font-semibold text-success">正常</span>
  if (status === 'mismatched') return <span className="text-sm font-semibold text-danger">要確認</span>
  if (status === 'unconfigured') return <span className="text-sm font-semibold text-warning">未設定</span>
  return <span className="text-sm font-semibold text-ink-faint">確認中</span>
}

export default function HqAccountList({
  accounts,
  onSelect,
  selectLabel = 'ログイン',
}: {
  accounts: AccountWithStats[]
  onSelect: (accountId: string) => void
  selectLabel?: string
}) {
  return (
    <section data-design="Table" className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
      <div className="w-full overflow-x-auto">
        <table className="min-w-max w-full text-left">
          <thead>
            <TableHeadRow>
              <Th>店舗</Th>
              <Th>LINE ID</Th>
              <Th align="right">友だち数</Th>
              <Th>Webhook状態</Th>
              <Th>状態</Th>
              <Th align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody className="divide-y divide-hairline">
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-canvas-sunken">
                <td className="px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountIcon account={account} />
                    <span className="max-w-72 truncate text-sm font-semibold text-ink" title={account.displayName || account.name}>{account.displayName || account.name}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-ink-secondary"><span className="block max-w-48 truncate" title={account.basicId || account.channelId}>{account.basicId || account.channelId}</span></td>
                <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums text-ink">{(account.stats?.friendCount ?? 0).toLocaleString('ja-JP')}</td>
                <td className="px-4 py-4"><WebhookStatus status={account.webhook?.status} /></td>
                <td className="px-4 py-4"><span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold ${account.isActive ? 'bg-accent-soft text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{account.isActive ? '有効' : '停止中'}</span></td>
                <td className="px-5 py-4 text-right"><Button type="button" variant="primary" onClick={() => onSelect(account.id)}>{selectLabel}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
