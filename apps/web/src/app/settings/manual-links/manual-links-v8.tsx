'use client'

import Button from '@/components/shared/button'
import SearchField from '@/components/shared/search-field'
import { DataTable, TableHeadRow, Th, Td, Tr } from '@/components/shared/table'
import StatusBadge from '@/components/shared/status-badge'
import ListState from '@/components/shared/list-state'
import FilterChip from '@/components/shared/filter-chip'
import {
  LINK_STATUS_LABEL,
  VERIFY_SCHEDULE_NOTE,
  checkedLabel,
  urlLabel,
} from './manual-link-view'
import { useManualLinks } from './use-manual-links'
import { SettingsShellV8 } from '../settings-nav-v8'
import styles from '../settings-v8.module.css'

/**
 * マニュアルの正本表の V8 画面（★V8-B `cIdA2`）。
 * 運営だけが見られる表。見える人だけに左メニューの入口を出す。
 */
export function ManualLinksV8() {
  const {
    rows,
    shown,
    total,
    status,
    checking,
    editingKey,
    editingUrl,
    setEditingUrl,
    saving,
    query,
    setQuery,
    filter,
    setFilter,
    actionError,
    notice,
    canEdit,
    loadInitial,
    checkAll,
    startEdit,
    cancelEdit,
    saveEdit,
  } = useManualLinks()

  if (status !== 'ready') {
    return (
      <SettingsShellV8
        title="マニュアルの正本表"
        description="画面の上の「マニュアル」が開く行き先を、画面ごとに決めます。"
      back={{ href: '/settings', label: '機能設定へ' }}
      >
        <ListState
          kind={status === 'error' ? 'error' : 'loading'}
          title={status === 'error' ? '正本表を読み込めませんでした' : undefined}
          description={status === 'error' ? '通信状態を確認して、もう一度読み込んでください。' : undefined}
          onRetry={status === 'error' ? () => void loadInitial(() => true) : undefined}
        />
      </SettingsShellV8>
    )
  }

  if (!canEdit) {
    return (
      <SettingsShellV8
        title="マニュアルの正本表"
        description="画面の上の「マニュアル」が開く行き先を、画面ごとに決めます。"
      back={{ href: '/settings', label: '機能設定へ' }}
      >
        <ListState
          kind="forbidden"
          title="この表は運営だけが見られます"
          description="画面のトップバーにある「マニュアル」の行き先を決める表です。変えたいときは運営に頼んでください。"
        />
      </SettingsShellV8>
    )
  }

  return (
    <SettingsShellV8
      title="マニュアルの正本表"
      description="画面の上の「マニュアル」が開く行き先を、画面ごとに決めます。"
      back={{ href: '/settings', label: '機能設定へ' }}
    >
      <p className={`${styles.band} ${styles.bandWarn}`}>
        <strong>この表を直せるのは運営だけです。</strong>
        画面のトップバーにある「マニュアル」は、ここで決めた行き先を開きます。お客さまの組織からは見えません。
      </p>

      <div className={styles.toolbar}>
        <span className={styles.toolbarSearch}>
          <input
            type="search"
            aria-label="画面ID・画面名で検索"
            placeholder="画面ID・画面名で検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </span>
        <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')}>
          すべて
        </FilterChip>
        <FilterChip
          selected={filter === 'broken'}
          onChange={(next) => setFilter(next ? 'broken' : 'all')}
          count={rows.filter((row) => row.status === 'broken').length}
        >
          開けない
        </FilterChip>
        <Button variant="secondary" disabled={checking} onClick={() => void checkAll()} busy={checking} busyLabel="確かめています…">
          いま全部を確かめる
        </Button>
      </div>

      {actionError && (
        <p role="alert" className={`${styles.band} ${styles.bandDanger}`}>
          {actionError}
        </p>
      )}

      <p className={styles.sectionTitle}>
        画面とマニュアルの対応 {total}件
        {notice ? <span className={styles.cardMeta}>　{notice}</span> : null}
      </p>

      {shown.length === 0 ? (
        <div data-design-node="bR6a1">
          <ListState
            kind="empty"
            title="当てはまる行がありません"
            description="検索の言葉か、状態の絞り込みを変えてください。"
            action={query || filter !== 'all' ? (
              <Button variant="secondary" onClick={() => { setQuery(''); setFilter('all') }}>
                条件を外す
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className={styles.tableCard}>
          <DataTable className="rounded-none border-0">
            <colgroup>
              <col style={{ width: '9%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>画面ID</Th>
                <Th>画面名</Th>
                <Th>公式記事のURL</Th>
                <Th>最後に確かめた日</Th>
                <Th>リンクの状態</Th>
                <Th className={styles.tdRight}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((row) => {
                const key = row.taskId ?? row.screenId
                const editing = editingKey === key
                return (
                  <Tr key={key}>
                    <Td>{row.screenId}</Td>
                    <Td><span className={styles.urlCell} title={row.name}>{row.name}</span></Td>
                    <Td>
                      {editing ? (
                        <input
                          className={styles.editInput}
                          aria-label={`${row.name}の公式記事URL`}
                          value={editingUrl}
                          onChange={(event) => setEditingUrl(event.target.value)}
                        />
                      ) : (
                        <span className={`${styles.urlCell} ${row.url ? '' : styles.urlEmpty}`} title={row.url || undefined}>
                          {urlLabel(row.url)}
                        </span>
                      )}
                    </Td>
                    <Td><span className={styles.urlCell} title={checkedLabel(row.checkedAt)}>{checkedLabel(row.checkedAt)}</span></Td>
                    <Td>
                      <StatusBadge tone={row.status === 'ok' ? 'success' : row.status === 'broken' ? 'danger' : 'neutral'} size="compact">{LINK_STATUS_LABEL[row.status]}</StatusBadge>
                    </Td>
                    <Td className={styles.tdRight}>
                      {editing ? (
                        <>
                          <Button variant="secondary" disabled={saving} onClick={cancelEdit}>キャンセル</Button>{' '}
                          <Button variant="primary" disabled={saving} onClick={() => void saveEdit()}>決める</Button>
                        </>
                      ) : (
                        <Button variant="secondary" onClick={() => startEdit(key)}>{row.url ? '直す' : '決める'}</Button>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
      )}

      <p className={styles.footNote}>
        {total > rows.length ? `ほか ${total - rows.length}件。` : ''}{VERIFY_SCHEDULE_NOTE}
      </p>
    </SettingsShellV8>
  )
}
