'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Th, Td, Tr } from '@/components/shared/table'
import Pagination from '@/components/shared/pagination'
import styles from './mileage.module.css'

type Item = { id: string; rewardName: string; status: string; updatedAt: string }
type Page = { items: Item[]; pagination: { total: number } }
export default function HeldRedemptions({ accountId }: { accountId: string }) {
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ accountId: string; data: Page } | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => { setPage(1) }, [accountId])
  useEffect(() => {
    let active = true
    setLoaded(null); setError(false)
    void fetchApi<{ success: boolean; data: Page }>(`/api/mileage/redemptions?accountId=${encodeURIComponent(accountId)}&status=reserved&limit=20&offset=${(page - 1) * 20}`)
      .then((result) => { if (!result.success || !Array.isArray(result.data?.items)) throw new Error('load_failed'); if (active) setLoaded({ accountId, data: result.data }) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [accountId, page, retry])
  const data = loaded?.accountId === accountId ? loaded.data : null
  if (error) return <ListState kind="error" title="保留中の交換を読み込めませんでした" onRetry={() => setRetry((n) => n + 1)} />
  if (!data || data.pagination.total === 0) return null
  return <section aria-label="保留中の交換" className={styles.subSection}>
    <p className={styles.subTitle}>保留中の交換 {data.pagination.total} 件</p>
    <p className={styles.subDesc}>EC管理に切り替わる前の交換です。自動で進めず、そのまま保留しています。</p>
    <DataTable><thead><TableHeadRow><Th grow>使い道</Th><Th>状態</Th><Th>最終更新</Th></TableHeadRow></thead>
      <tbody>{data.items.map((item) => <Tr key={item.id}><Td grow>{item.rewardName}</Td><Td>保留中</Td><Td>{item.updatedAt.slice(0, 10)}</Td></Tr>)}</tbody>
    </DataTable>
    {data.pagination.total > 20 ? <Pagination page={page} pageCount={Math.ceil(data.pagination.total / 20)} onPageChange={setPage} ariaLabel="保留中の交換のページ送り" /> : null}
  </section>
}
