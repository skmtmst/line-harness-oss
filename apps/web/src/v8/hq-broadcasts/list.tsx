'use client'

/*
 * ★V8 統括 一括配信の一覧（提案 E-9 の入口。絵は作る p17Qku と結果 xOXuY だけなので、一覧は型どおりの最小の形）。
 * 1行＝1回の一括配信。名前・状態・店の数・送る日時。行を押すと詳細（送った結果）へ。動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { HqBroadcastRun } from '@line-crm/shared'
import { ListPage } from '@/components/templates/list-page'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { jpDateTime, runBadge, sendTotals } from './model'
import styles from './list.module.css'

export default function HqBroadcastList() {
  usePageTitle('一括配信')
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
  const [runs, setRuns] = useState<HqBroadcastRun[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    try {
      const res = await hqBroadcastsApi.list()
      setRuns(res.data); setError(null)
    } catch (caught) {
      setError(caught)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  let content
  if (error && !runs) content = <ListState kind="error" error={error} onRetry={() => void load()} />
  else if (!runs) content = <ListState kind="loading" />
  else if (runs.length === 0) {
    content = (
      <ListState
        kind="empty"
        title="一括配信はまだありません"
        description="アカウントのタグか店を選んで、同じ内容を一度に送れます。各店のアカウントに入らずに送れます。"
        action={canManage ? <Button variant="primary" href="/hq/broadcasts/new"><Plus size={15} aria-hidden="true" />一括配信を作る</Button> : undefined}
      />
    )
  } else {
    content = (
      <DataTable className={styles.table} data-design="hq-broadcasts">
        <thead>
          <TableHeadRow>
            <Th>配信</Th>
            <Th className={styles.colState}>状態</Th>
            <Th className={styles.colStores}>店</Th>
            <Th className={styles.colAt}>送る日時</Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {runs.map((run) => {
            const badge = runBadge(run)
            const totals = sendTotals(run.targets)
            const href = `/hq/broadcasts/detail?id=${encodeURIComponent(run.id)}`
            const stores = run.status === 'prepared' ? `${totals.sendStores}店（外す ${totals.skipStores}店）` : `${run.targets.filter((t) => !t.excluded).length}店`
            return (
              <Tr key={run.id}>
                <Td><Link href={href} className={styles.title} title={run.title}>{run.title}</Link></Td>
                <Td className={styles.colState}><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                <Td className={styles.colStores}><span className={styles.sub}>{stores}</span></Td>
                <Td className={styles.colAt}><span className={styles.sub}>{run.scheduledAt ? jpDateTime(run.scheduledAt) : 'すぐ送る'}</span></Td>
                <Td className={styles.colMenu}>
                  <RowActions subjectName={run.title} menuItems={[{ id: 'open', label: run.status === 'prepared' ? '確かめて送る' : '送った結果を見る', onSelect: () => { window.location.href = href } }]} />
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    )
  }

  return (
    <ListPage
      headingSize="compact"
      title="一括配信"
      help="選んだアカウント（店）に同じ内容を一度に送った記録です。店の一斉配信の一覧にも「統括から」の印つきで出ます（店では変えられません）。"
      actions={canManage ? <Button variant="primary" href="/hq/broadcasts/new"><Plus size={15} aria-hidden="true" />一括配信を作る</Button> : undefined}
    >
      {content}
    </ListPage>
  )
}
