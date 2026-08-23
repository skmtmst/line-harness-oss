'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi, type RestaurantStore } from '@/lib/restaurant-test-api'

const lineStatusLabel: Record<RestaurantStore['line_status'], string> = {
  connected: '接続済み',
  unconfigured: '未接続',
  warning: '要確認',
  error: '要確認',
}

function lineStatusClass(status: RestaurantStore['line_status']): string {
  if (status === 'connected') return 'bg-accent-soft text-success'
  if (status === 'unconfigured') return 'bg-canvas-sunken text-ink-secondary'
  return 'bg-warning-bg text-warning'
}

export default function StoreList() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [stores, setStores] = useState<RestaurantStore[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectingId, setSelectingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setStores([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      await restaurantTestApi.clearStoreSelection(selectedAccountId)
      const response = await restaurantTestApi.listStores(selectedAccountId)
      setStores(response.data.stores)
      setOrganizationName(response.data.organization?.name || '')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '店舗一覧を読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(
    () => stores.filter((store) => showArchived || store.status !== 'archived'),
    [showArchived, stores],
  )

  const selectStore = async (store: RestaurantStore) => {
    if (!selectedAccountId || store.status === 'archived') return
    setSelectingId(store.id)
    setError('')
    try {
      await restaurantTestApi.selectStore(selectedAccountId, store.id)
      router.push('/restaurant-test/dashboard')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '店舗へ切り替えられませんでした。')
      setSelectingId('')
    }
  }

  return <div>
    <Header
      title="店舗一覧"
      description={`${organizationName || '統括'}に属する店舗と、LINE公式アカウントの接続状態を確認します。`}
      action={<Link href="/restaurant-test/stores/new" className="inline-flex rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent">＋ 店舗を追加</Link>}
    />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-canvas px-4 py-3">
      <p className="text-sm text-ink-secondary">店舗の「ログイン」を押すと、その店舗だけを表示する管理画面へ切り替わります。</p>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-secondary">
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-4 w-4 accent-accent" />
        アーカイブ済みも表示
      </label>
    </div>
    {error && <div role="alert" className="mb-4 rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>}
    {loading ? <div className="rounded-card border border-hairline bg-canvas p-16 text-center text-sm text-ink-faint">店舗を読み込んでいます…</div>
      : stores.length === 0 ? <div className="rounded-card border border-hairline bg-canvas p-12 text-center">
        <h2 className="text-lg font-bold text-ink">まだ店舗が登録されていません</h2>
        <p className="mt-2 text-sm text-ink-secondary">最初の店舗とLINE公式アカウントを接続してください。</p>
        <Link href="/restaurant-test/stores/new" className="mt-6 inline-flex rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent">店舗を追加</Link>
      </div>
      : <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-canvas-sunken text-xs text-ink-faint"><tr>
              <th className="px-5 py-3 font-semibold">店舗</th>
              <th className="px-5 py-3 font-semibold">店舗の状態</th>
              <th className="px-5 py-3 font-semibold">LINE接続</th>
              <th className="px-5 py-3 font-semibold">LINE公式アカウント</th>
              <th className="px-5 py-3 text-right font-semibold">友だち数</th>
              <th className="px-5 py-3 text-right font-semibold">操作</th>
            </tr></thead>
            <tbody className="divide-y divide-hairline">{shown.map((store) => <tr key={store.id}>
              <td className="px-5 py-4"><p className="font-semibold text-ink">{store.name}</p><p className="mt-1 text-xs text-ink-faint">{store.code}</p></td>
              <td className="px-5 py-4"><span className={`inline-flex rounded-pill px-2.5 py-1 text-xs font-semibold ${store.status === 'active' ? 'bg-accent-soft text-success' : 'bg-canvas-sunken text-ink-secondary'}`}>{store.status === 'active' ? '稼働中' : store.status === 'archived' ? 'アーカイブ済み' : '一時停止'}</span></td>
              <td className="px-5 py-4"><span className={`inline-flex rounded-pill px-2.5 py-1 text-xs font-semibold ${lineStatusClass(store.line_status)}`}>{lineStatusLabel[store.line_status]}</span></td>
              <td className="px-5 py-4 text-ink-secondary">{store.line_account_name || '—'}</td>
              <td className="px-5 py-4 text-right font-semibold tabular-nums text-ink">{store.friend_count == null ? '—' : `${store.friend_count.toLocaleString('ja-JP')}人`}</td>
              <td className="px-5 py-4 text-right"><button type="button" disabled={store.status === 'archived' || selectingId === store.id} onClick={() => void selectStore(store)} className="rounded-control bg-accent px-4 py-2 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">{selectingId === store.id ? '切り替え中…' : 'ログイン'}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="p-10 text-center text-sm text-ink-faint">表示できる店舗がありません。</p>}
      </div>}
  </div>
}
