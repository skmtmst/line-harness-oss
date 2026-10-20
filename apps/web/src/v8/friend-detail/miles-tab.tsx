'use client'

/*
 * マイルタブ。残高と履歴はマイル画面（この人のマイル詳細）で見る。
 * 会員ランクの履歴（日時・前→後・理由）は、ここに出す（mAbif）。ランクを動かしていない店では、段を出さない。
 */
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { memberRanksApi } from '@/lib/api/helpers/gap3'
import EmptyTab from './empty-tab'
import styles from './delivery-consent.module.css'

type RankHistory = { id: string; from_tier_id: string | null; to_tier_id: string; reason: string; at: string }

const REASONS: Record<string, string> = { activated: 'ランクを動かした', upgrade: '条件を満たした', downgrade: '条件を下回った', grace: '猶予が終わった', recovered: '回復した', manual: '店が変えた' }
const md = (value: string) => `${value.slice(0, 4)}/${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`

export default function MilesTab({ friendId }: { friendId: string }) {
  const { selectedAccountId } = useAccount()
  const [history, setHistory] = useState<RankHistory[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    void Promise.all([memberRanksApi.friend(selectedAccountId, friendId), memberRanksApi.program(selectedAccountId)]).then(([rank, program]) => {
      if (!alive) return
      if (rank.success) setHistory(((rank.data as { history?: RankHistory[] } | null)?.history) ?? [])
      if (program.success) setNames(Object.fromEntries(program.data.tiers.map((tier) => [tier.id, tier.name])))
    }).catch(() => undefined)
    return () => { alive = false }
  }, [selectedAccountId, friendId])
  return (
    <>
      <EmptyTab
        icon={<Star size={17} />}
        title="この友だちのマイルはマイル画面で見られます"
        text="マイル残高と履歴は、マイル画面で確認できます。"
        actions={[{ label: 'マイルを確認 ↗', href: `/mileage/friends/detail?id=${encodeURIComponent(friendId)}` }]}
      />
      {history.length > 0 ? (
        <section className={styles.body} aria-label="会員ランクの履歴">
          <h3 className={styles.sectionTitle}>会員ランクの履歴</h3>
          <DataTable>
            <thead><TableHeadRow><Th>日時</Th><Th>前 → 後</Th><Th grow>理由</Th></TableHeadRow></thead>
            <tbody>
              {history.map((row) => (
                <Tr key={row.id}>
                  <Td>{md(row.at)}</Td>
                  <Td>{`${row.from_tier_id ? names[row.from_tier_id] ?? '—' : '—'} → ${names[row.to_tier_id] ?? '—'}`}</Td>
                  <Td grow>{REASONS[row.reason] ?? row.reason}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </section>
      ) : null}
    </>
  )
}
