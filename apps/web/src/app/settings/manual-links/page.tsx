'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  LINK_STATUS_LABEL,
  MISSING_SCREENS_NOTE,
  STATUS_FILTERS,
  VERIFY_SCHEDULE_NOTE,
  VERIFY_UNAVAILABLE_NOTE,
  type StatusFilter,
  brokenNotice,
  canEditTable,
  checkedLabel,
  localRows,
  matchesQuery,
  matchesStatus,
  urlLabel,
} from './manual-link-view'
import styles from './manual-links.module.css'

/**
 * 設計 ★V6 34-4「マニュアルの正本表」（`f9oUm`、運営側）。
 *
 * **お客さまの組織からは見えない。** 統括だけが開ける。
 */
export default function ManualLinksPage() {
  /*
    トップバーの画面名。`/settings/` で始まるので、そのままだと
    メニューの「機能設定」が出てしまう。設計 `f9oUm` は「マニュアル」。
  */
  usePageTitle('マニュアルの正本表')
  const [role, setRole] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    let alive = true
    void api.staff
      .me()
      .then((res) => {
        if (!alive) return
        if (!res.success) {
          setStatus('error')
          return
        }
        setRole(res.data?.role ?? null)
        setStatus('ready')
      })
      .catch(() => {
        if (alive) setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => localRows(), [])
  const shown = rows.filter((r) => matchesStatus(r, filter) && matchesQuery(r, query))
  const notice = brokenNotice(rows)

  if (status !== 'ready') {
    return <ListState kind={status === 'error' ? 'error' : 'loading'} />
  }

  if (!canEditTable(role)) {
    return (
      <ListState
        kind="forbidden"
        title="この表は運営だけが見られます"
        description="画面のトップバーにある「マニュアル」の行き先を決める表です。変えたいときは運営に頼んでください。"
      />
    )
  }

  return (
    <div className={styles.page}>
      <div role="note">
        <strong>この表を直せるのは運営だけです</strong>
        <span>画面のトップバーにある「マニュアル」は、ここで決めた行き先を開きます。表を直すと、その画面のマニュアルの行き先が変わります。お客さまの組織からは見えません。</span>
      </div>

      <ListToolbar
        searchPlaceholder="画面ID・画面名で検索"
        searchValue={query}
        onSearchChange={setQuery}
      >
        <SelectField
          aria-label="リンクの状態"
          value={filter}
          onChange={(event) => setFilter(event.target.value as StatusFilter)}
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: `状態：${f.label}` }))}
        />
        {/* 押せないものを、押せる形にしない。 */}
        <span className={styles.blocked} title={VERIFY_UNAVAILABLE_NOTE}>
          いま全部を確かめる
        </span>
      </ListToolbar>

      <div data-manual-table-title>
        <strong>画面とマニュアルの対応 {rows.length}件</strong>
        <span>{MISSING_SCREENS_NOTE}</span>
        {notice ? <em>{notice}</em> : null}
      </div>

      {shown.length === 0 ? (
        <ListState
          kind="empty"
          title="当てはまる行がありません"
          description="検索の言葉か、状態の絞り込みを変えてください。"
        />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>画面ID</Th>
              <Th>画面名</Th>
              <Th>公式記事のURL</Th>
              <Th>最後に確かめた日</Th>
              <Th>リンクの状態</Th>
              <Th>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Tr key={row.taskId ?? row.screenId}>
                <Td>{row.screenId}</Td>
                <Td>{row.name}</Td>
                <Td>
                  <span className={row.url ? styles.url : styles.urlEmpty}>
                    {urlLabel(row.url)}
                  </span>
                </Td>
                <Td>{checkedLabel(row.checkedAt)}</Td>
                <Td>
                  <StatusBadge
                    tone={row.status === 'ok' ? 'success' : row.status === 'broken' ? 'danger' : 'neutral'}
                    size="compact"
                  >
                    {LINK_STATUS_LABEL[row.status]}
                  </StatusBadge>
                </Td>
                <Td><span className={styles.blocked}>直す</span></Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <p className={styles.footNote}>
        {VERIFY_SCHEDULE_NOTE}
        <br />
        {VERIFY_UNAVAILABLE_NOTE}
      </p>
    </div>
  )
}
