'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'

function AccountIcon({ account }: { account: AccountWithStats }) {
  if (account.pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={account.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-control object-cover" />
  }
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-sm font-bold text-accent">然</span>
}

function webhookLabel(status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown' | undefined) {
  if (status === 'matched') return { label: '正常', className: 'text-success' }
  if (status === 'mismatched') return { label: '要確認', className: 'text-danger' }
  if (status === 'unconfigured') return { label: '未設定', className: 'text-warning' }
  return { label: '確認中', className: 'text-ink-faint' }
}

export default function HqPage() {
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [tenantName, setTenantName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.lineAccounts.list(), api.tenants.me()])
      .then(([accountResponse, tenantResponse]) => {
        if (cancelled) return
        if (!accountResponse.success) throw new Error(accountResponse.error)
        if (!tenantResponse.success) throw new Error(tenantResponse.error)
        setAccounts(accountResponse.data as AccountWithStats[])
        setTenantName(tenantResponse.data.name)
      })
      .catch(() => {
        if (!cancelled) setError('統括の店舗情報を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const login = (accountId: string) => {
    setSelectedAccountId(accountId)
    router.push('/')
  }

  return (
    <div>
      <header data-design="Head" className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-accent">統括コンソール</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-ink" title={tenantName || '統括'}>
            {tenantName || (loading ? '統括を読み込み中…' : '統括')}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">LINE公式アカウントごとに店舗の管理画面へ移動できます。</p>
        </div>
        <Link href="/restaurant-test/stores/new" className="shrink-0 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover">
          ＋店舗の新規アカウント登録
        </Link>
      </header>

      {error ? <div className="rounded-card bg-danger-bg p-4 text-sm text-danger" role="alert">{error}</div> : null}

      {!error && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="店舗を読み込み中">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-hairline border-t-accent" />
        </div>
      ) : null}

      {!error && !loading && accounts.length === 0 ? (
        <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink">まだ店舗がありません</h2>
          <p className="mt-2 text-sm text-ink-secondary">最初のLINE公式アカウントを登録すると、ここから店舗へログインできます。</p>
          <Link href="/restaurant-test/stores/new" className="mt-6 inline-flex rounded-control bg-accent px-6 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover">
            ＋店舗の新規アカウント登録
          </Link>
        </section>
      ) : null}

      {!error && !loading && accounts.length > 0 ? (
        <section data-design="Table" className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[920px] w-full text-left">
              <thead className="border-b border-hairline bg-canvas-sunken text-xs font-semibold text-ink-faint">
                <tr>
                  <th className="px-5 py-3.5">店舗</th>
                  <th className="px-4 py-3.5">LINE ID</th>
                  <th className="px-4 py-3.5 text-right">友だち数</th>
                  <th className="px-4 py-3.5">Webhook状態</th>
                  <th className="px-4 py-3.5">状態</th>
                  <th className="px-5 py-3.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {accounts.map((account) => {
                  const webhook = webhookLabel(account.webhook?.status)
                  return (
                    <tr key={account.id} className="hover:bg-canvas-sunken">
                      <td className="px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <AccountIcon account={account} />
                          <span className="max-w-[300px] truncate text-sm font-semibold text-ink" title={account.displayName || account.name}>{account.displayName || account.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-secondary"><span className="block max-w-48 truncate" title={account.basicId || account.channelId}>{account.basicId || account.channelId}</span></td>
                      <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums text-ink">{(account.stats?.friendCount ?? 0).toLocaleString('ja-JP')}</td>
                      <td className={`px-4 py-4 text-sm font-semibold ${webhook.className}`}>{webhook.label}</td>
                      <td className="px-4 py-4"><span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold ${account.isActive ? 'bg-accent-soft text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{account.isActive ? '有効' : '停止中'}</span></td>
                      <td className="px-5 py-4 text-right"><button type="button" onClick={() => login(account.id)} className="rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">ログイン</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
