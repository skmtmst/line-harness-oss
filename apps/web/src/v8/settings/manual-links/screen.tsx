'use client'

/*
 * ★V8 マニュアルの正本表（Pencil 、状態は ）。
 *
 * 動き（読み込み・権限・いま全部を確かめる・直す／決める・競合の読み直し）は
 * 今までの V8（app/settings/manual-links/manual-links-v8.tsx）と同じ。処理は同じ場所の
 * use-manual-links.ts（写し）に置く。見た目だけを型（SettingsPage）と部品で組み直した。
 */
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { RefreshCw } from 'lucide-react'
import Button from '@/components/shared/button'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import ListToolbar from '@/components/shared/list-toolbar'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { formatDate } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'
import FilterChip from '@/components/shared/filter-chip'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import ListState from '@/components/shared/list-state'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import { LINK_STATUS_LABEL, checkedLabel, urlLabel } from './manual-link-view'
import { useManualLinks } from './use-manual-links'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './screen.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'

const TITLE = 'マニュアルの正本表'
const DESCRIPTION = '画面の上の「マニュアル」が開く行き先を、画面ごとに決めます'
/** 確かめる時刻（サーバの定時の確認と同じ）。 */
const SCHEDULE = '毎日 4:00 に確かめる'

export default function ManualLinksScreen() {
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
    canView,
    loadInitial,
    checkAll,
    startEdit,
    cancelEdit,
    saveEdit,
    guard,
    dirty,
  } = useManualLinks()

  const frame = (children: React.ReactNode) => (
    <SbSettingsScreen boardId="cIdA2" title={TITLE} help={DESCRIPTION} explanation="この表を直せるのは運営だけです。お客さまの組織からは見えません。"
      saveStatus={canEdit && editingKey ? `${rows.find(row => (row.taskId ?? row.screenId) === editingKey)?.name ?? ''}の行き先を編集中` : undefined}
      saveActions={canEdit && editingKey && (dirty || saving) ? <>
        <Button variant="secondary" disabled={saving} onClick={cancelEdit}>キャンセル</Button>
        <Button variant="primary" actionWording disabled={saving} onClick={() => void saveEdit()} busy={saving} busyLabel="保存しています…">決める</Button>
      </> : undefined}>

      {children}
      <UnsavedLeaveDialog open={guard.leaveTarget !== null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </SbSettingsScreen>
  )

  if (status !== 'ready') {
    return frame(
      <ListState
        kind={status === 'error' ? 'error' : 'loading'}
        title={status === 'error' ? '正本表を読み込めませんでした' : undefined}
        description={status === 'error' ? '通信状態を確認して、もう一度読み込んでください。' : undefined}
        onRetry={status === 'error' ? () => void loadInitial(() => true) : undefined}
      />,
    )
  }

  if (!canView) {
    return frame(
      <ListState
        kind="forbidden"
        title="この表は運営だけが見られます"
        description="画面のトップバーにある「マニュアル」の行き先を決める表です。変えたいときは運営に頼んでください。"
      />,
    )
  }

  const brokenCount = rows.filter((row) => row.status === 'broken').length

  return frame(
    <>


      {!canEdit ? <ReadOnlyNotice /> : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: '画面ID・画面名で探す' }}
        filters={<>
          <FilterChip selectedIcon={false} selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
          <FilterChip selectedIcon={false} selected={filter === 'broken'} onChange={(selected) => setFilter(selected ? 'broken' : 'all')}>{`開けない ${brokenCount}`}</FilterChip>
        </>}
        trailing={<>
          <span className={styles.schedule}>{SCHEDULE}</span>
          {canEdit ? <Button variant="secondary" disabled={checking} onClick={() => void checkAll()} busy={checking} busyLabel="確かめています…"><RefreshCw aria-hidden="true" />いま全部を確かめる</Button> : null}
        </>}
      />

      {actionError && <Notice tone="danger" className={styles.dangerNoticePlacement} >{actionError}</Notice>}

      {shown.length === 0 ? (
        <ListState
          kind="empty"
          emptyPreset="filtered"
          title="条件に合うものはありません"
          description="札や検索を外すと、すべて出ます"
          action={query || filter !== 'all' ? (
            <Button variant="secondary" onClick={() => { setQuery(''); setFilter('all') }}>条件を外す</Button>
          ) : undefined}
        />
      ) : (
        <GridTable className={styles.table} label={`画面とマニュアルの対応 ${total} 件`} design={{ columns: 'var(--sett-manual-columns)', gap: 'var(--tpl-sb-tbl-gap)', padding: 'var(--tpl-sb-tbl-pad)', rowPadding: 'var(--tpl-sb-tbl-row-pad)', fontSize: 'var(--tpl-sb-tbl-head)', color: 'var(--color-ink)' }}>
          <div role="rowgroup">
            <GridHeadRow>
              <GridCell role="columnheader">画面ID</GridCell>
              <GridCell role="columnheader">画面名</GridCell>
              <GridCell role="columnheader">マニュアルのURL</GridCell>
              <GridCell role="columnheader">確かめた日</GridCell>
              <GridCell role="columnheader">状態</GridCell>
              <GridCell role="columnheader"><span className={styles.srOnly}>操作</span></GridCell>
            </GridHeadRow>
          </div>
          <div role="rowgroup">
            {shown.map((row) => {
              const key = row.taskId ?? row.screenId
              const editing = canEdit && editingKey === key
              const checked = row.checkedAt ? formatDate(row.checkedAt, { style: 'list', fallback: checkedLabel(row.checkedAt) }) : emptyValue('unknown')
              return (
                <GridRow key={key} data-broken={row.status !== 'ok' || undefined}>
                  <GridCell role="cell" className={styles.cell}>{row.screenId}</GridCell>
                  <GridCell role="cell" className={`${styles.cell} ${styles.name}`} title={row.name}>{row.name}</GridCell>
                  <GridCell role="cell" className={styles.cell} title={urlLabel(row.url)}>
                    {editing ? (
                      <SaveErrorField names={["editingUrl","editing_url"]}><TextField
                        aria-label={`${row.name}のマニュアルのURL`}
                        value={editingUrl}
                        onChange={(event) => setEditingUrl(event.target.value)}
                      /></SaveErrorField>
                    ) : (
                      <span className={row.url ? styles.url : styles.urlEmpty} title={row.url || undefined}>{row.url ? urlLabel(row.url) : emptyValue('unconfigured')}</span>
                    )}
                  </GridCell>
                  <GridCell role="cell" className={styles.cell} title={checkedLabel(row.checkedAt)}><span data-list-date-time>{checked}</span></GridCell>
                  <GridCell role="cell" className={styles.cell} title={LINK_STATUS_LABEL[row.status]}>
                    <StatusBadge tone={row.status === 'ok' ? 'success' : row.status === 'broken' ? 'danger' : 'neutral'}>{row.status === 'unset' ? emptyValue('unconfigured') : LINK_STATUS_LABEL[row.status]}</StatusBadge>
                  </GridCell>
                  <GridCell role="cell" className={styles.actions}>
                    {!canEdit || editing ? null : <RowActions subjectName={row.name} menuItems={[{ id: 'edit', label: row.url ? '行き先を編集する' : '行き先を決める', onSelect: () => startEdit(key) }]} />}
                  </GridCell>
                </GridRow>
              )
            })}
          </div>
        </GridTable>
      )}

      {notice ? <p className={styles.footDanger}>{notice}</p> : null}
      {total > rows.length ? <p className={styles.foot}>{`ほか ${total - rows.length} 件。`}</p> : null}
    </>,
  )
}
