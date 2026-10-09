'use client'

/*
 * ★V8 マニュアルの正本表（Pencil `cIdA2`、状態は `bR6a1`）。
 *
 * 動き（読み込み・権限・いま全部を確かめる・直す／決める・競合の読み直し）は
 * 今までの V8（app/settings/manual-links/manual-links-v8.tsx）と同じ。処理は同じ場所の
 * use-manual-links.ts（写し）に置く。見た目だけを型（SettingsPage）と部品で組み直した。
 */
import { RefreshCw, ShieldCheck } from 'lucide-react'
import Button from '@/components/shared/button'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import ListState from '@/components/shared/list-state'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import { LINK_STATUS_LABEL, checkedLabel, urlLabel } from './manual-link-view'
import { useManualLinks } from './use-manual-links'
import styles from './screen.module.css'

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
    loadInitial,
    checkAll,
    startEdit,
    cancelEdit,
    saveEdit,
  } = useManualLinks()

  const frame = (children: React.ReactNode) => (
    <SbSettingsScreen boardId="cIdA2" title={TITLE} description={DESCRIPTION}>
      {children}
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

  if (!canEdit) {
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
      <Notice tone="warn" icon={<ShieldCheck size={16} aria-hidden="true" />}>この表を直せるのは運営だけです。お客さまの組織からは見えません。</Notice>

      <div className={styles.toolbar}>
        <SearchField
          aria-label="画面ID・画面名で探す"
          placeholder="画面ID・画面名で探す"
          value={query}
          onChange={setQuery}
          className={styles.search}
        />
        <FilterChip selectedIcon={false} selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
        <FilterChip selectedIcon={false} selected={filter === 'broken'} onChange={(selected) => setFilter(selected ? 'broken' : 'all')}>{`開けない ${brokenCount}`}</FilterChip>
        <span className={styles.spacer} />
        <span className={styles.schedule}>{SCHEDULE}</span>
        <Button variant="secondary" disabled={checking} onClick={() => void checkAll()} busy={checking} busyLabel="確かめています…">
          <RefreshCw className={styles.btnIcon} aria-hidden="true" />
          いま全部を確かめる
        </Button>
      </div>

      {actionError && <p role="alert" className={styles.danger}>{actionError}</p>}

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
              const editing = editingKey === key
              return (
                <GridRow key={key} data-broken={row.status !== 'ok' || undefined}>
                  <GridCell role="cell" className={styles.cell}>{row.screenId}</GridCell>
                  <GridCell role="cell" className={`${styles.cell} ${styles.name}`} title={row.name}>{row.name}</GridCell>
                  <GridCell role="cell" className={styles.cell} title={urlLabel(row.url)}>
                    {editing ? (
                      <TextField
                        aria-label={`${row.name}のマニュアルのURL`}
                        value={editingUrl}
                        onChange={(event) => setEditingUrl(event.target.value)}
                      />
                    ) : (
                      <span className={row.url ? styles.url : styles.urlEmpty} title={row.url || undefined}>{urlLabel(row.url)}</span>
                    )}
                  </GridCell>
                  <GridCell role="cell" className={styles.cell} title={checkedLabel(row.checkedAt)}>{checkedLabel(row.checkedAt)}</GridCell>
                  <GridCell role="cell" className={styles.cell} title={LINK_STATUS_LABEL[row.status]}>
                    <span className={styles.status} data-status={row.status}>{LINK_STATUS_LABEL[row.status]}</span>
                  </GridCell>
                  <GridCell role="cell" className={styles.actions}>
                    {editing ? (
                      <>
                        <Button variant="text" disabled={saving} onClick={cancelEdit}>キャンセル</Button>
                        <Button variant="primary" disabled={saving} onClick={() => void saveEdit()}>決める</Button>
                      </>
                    ) : (
                      <Button variant="text" onClick={() => startEdit(key)} aria-label={`${row.name}の行き先を${row.url ? '直す' : '決める'}`}>
                        {row.url ? '直す' : '決める'}
                      </Button>
                    )}
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
