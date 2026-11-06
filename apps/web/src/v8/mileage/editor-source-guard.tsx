'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import ListState from '@/components/shared/list-state'

export default function EditorSourceGuard({ children }: { children: ReactNode }) {
  const { selectedAccountId, loading } = useAccount()
  const [source, setSource] = useState<{ account: string; value: 'ec' | 'musubo' | 'error' } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!selectedAccountId) return
    let active = true
    const account = selectedAccountId
    void api.mileage.friendsV6({ accountId: account, limit: 1, offset: 0 }).then((result) => {
      const value = result.success ? result.data?.balanceSource : null
      if (active) setSource({ account, value: value === 'ec' || value === 'musubo' ? value : 'error' })
    }).catch(() => { if (active) setSource({ account, value: 'error' }) })
    return () => { active = false }
  }, [selectedAccountId, retry])
  if (!loading && !selectedAccountId) return <ListState kind="empty" title="LINEアカウントを選択してください" />
  if (!selectedAccountId || source?.account !== selectedAccountId) return <ListState kind="loading" title="マイルの管理元を確認しています" />
  if (source.value === 'error') return <ListState kind="error" title="マイルの管理元を読み込めませんでした" onRetry={() => setRetry((n) => n + 1)} />
  if (source.value === 'ec') return <ListState kind="empty" title="マイルはECで管理しています" description="決めごとや使い道は一覧から確認できます。" />
  return children
}
