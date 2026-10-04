'use client'

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import {
  LINK_STATUS_LABEL,
  VERIFY_SCHEDULE_NOTE,
  checkedLabel,
  urlLabel,
} from './manual-link-view'
import { useManualLinks } from './use-manual-links'
import { ManualLinksV8 } from './manual-links-v8'
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
  const theme = useAdminTheme()
  if (theme === 'v8') return <ManualLinksV8 />
  return <ManualLinksPageV7 />
}

function ManualLinksPageV7() {
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
    statusFilters,
  } = useManualLinks()

  if (status !== 'ready') {
    return (
      <ListState
        kind={status === 'error' ? 'error' : 'loading'}
        title={status === 'error' ? '正本表を読み込めませんでした' : undefined}
        description={status === 'error' ? '通信状態を確認して、もう一度読み込んでください。' : undefined}
        onRetry={status === 'error' ? () => void loadInitial(() => true) : undefined}
      />
    )
  }

  if (!canEdit) {
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
        search={{ placeholder: '画面ID・画面名で検索', value: query, onChange: setQuery }}
        filters={
          <Select
            aria-label="リンクの状態"
            value={filter}
            onChange={(value) => setFilter(value as typeof filter)}
            options={statusFilters.map((f) => ({ value: f.value, label: `状態：${f.label}` }))}
          />
        }
        trailing={
          <Button disabled={checking} onClick={() => void checkAll()} busy={checking} busyLabel="確かめています…">いま全部を確かめる
          </Button>
        }
      />

      {actionError && (
        <p role="alert" className={styles.actionError}>
          {actionError}
        </p>
      )}

      <div data-manual-table-title>
        <strong>画面とマニュアルの対応 {total}件</strong>
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
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <TableHeadRow>
              <Th>画面ID</Th>
              <Th>画面名</Th>
              <Th>公式記事のURL</Th>
              <Th>最後に確かめた日</Th>
              <Th>リンクの状態</Th>
              {/* 操作は右へ寄せ、右端の余白を左端とそろえる。 */}
              <Th align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {shown.map((row) => {
              const key = row.taskId ?? row.screenId
              const editing = editingKey === key
              return (
              <Tr key={key}>
                <Td>{row.screenId}</Td>
                <Td>{row.name}</Td>
                <Td>
                  {editing ? (
                    <input
                      style={{ width: '100%', minWidth: 0, padding: '7px 9px' }}
                      aria-label={`${row.name}の公式記事URL`}
                      value={editingUrl}
                      onChange={(event) => setEditingUrl(event.target.value)}
                    />
                  ) : (
                    <span className={row.url ? styles.url : styles.urlEmpty} title={row.url || undefined}>
                      {urlLabel(row.url)}
                    </span>
                  )}
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
                <Td align="right">
                  {editing ? (
                    <>
                      <Button disabled={saving} onClick={cancelEdit}>キャンセル</Button>
                      <Button disabled={saving} onClick={() => void saveEdit()}>保存する</Button>
                    </>
                  ) : (
                    <Button onClick={() => startEdit(key)}>編集</Button>
                  )}
                </Td>
              </Tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      <p className={styles.footNote}>
        {total > rows.length ? `ほか ${total - rows.length}件。` : ''}{VERIFY_SCHEDULE_NOTE}
      </p>
    </div>
  )
}
