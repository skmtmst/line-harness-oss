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
import SearchField from '@/components/shared/search-field'
import ListState from '@/components/shared/list-state'
import { SbBackLink, SbSettingsScreen } from '../sb-frame/settings-screen'
import { LINK_STATUS_LABEL, checkedLabel, urlLabel } from './manual-link-view'
import { useManualLinks } from './use-manual-links'
import styles from './screen.module.css'

const TITLE = 'マニュアルの正本表'
const DESCRIPTION = '画面の上の「マニュアル」が開く行き先を、画面ごとに決めます'
const BACK = <SbBackLink href="/settings" label="機能設定へ" />
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
    <SbSettingsScreen boardId="cIdA2" title={TITLE} description={DESCRIPTION} identity={BACK}>
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
      <p className={styles.note}>
        <ShieldCheck className={styles.noteIcon} aria-hidden="true" />
        <span>この表を直せるのは運営だけです。お客さまの組織からは見えません。</span>
      </p>

      <div className={styles.toolbar}>
        <SearchField
          aria-label="画面ID・画面名で探す"
          placeholder="画面ID・画面名で探す"
          value={query}
          onChange={setQuery}
          className={styles.search}
        />
        <button type="button" className={styles.chip} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          すべて
        </button>
        <button
          type="button"
          className={styles.chip}
          aria-pressed={filter === 'broken'}
          onClick={() => setFilter(filter === 'broken' ? 'all' : 'broken')}
        >
          {`開けない ${brokenCount}`}
        </button>
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
        <div className={styles.table} role="table" aria-label={`画面とマニュアルの対応 ${total}件`}>
          <div role="rowgroup">
            <div role="row" className={`${styles.row} ${styles.headRow}`}>
              <span role="columnheader">画面ID</span>
              <span role="columnheader">画面名</span>
              <span role="columnheader">マニュアルのURL</span>
              <span role="columnheader">確かめた日</span>
              <span role="columnheader">状態</span>
              <span role="columnheader"><span className={styles.srOnly}>操作</span></span>
            </div>
          </div>
          <div role="rowgroup">
            {shown.map((row) => {
              const key = row.taskId ?? row.screenId
              const editing = editingKey === key
              return (
                <div role="row" key={key} className={styles.row} data-broken={row.status !== 'ok' || undefined}>
                  <span role="cell" className={styles.cell}>{row.screenId}</span>
                  <span role="cell" className={`${styles.cell} ${styles.name}`} title={row.name}>{row.name}</span>
                  <span role="cell" className={styles.cell}>
                    {editing ? (
                      <input
                        className={styles.editInput}
                        aria-label={`${row.name}のマニュアルのURL`}
                        value={editingUrl}
                        onChange={(event) => setEditingUrl(event.target.value)}
                      />
                    ) : (
                      <span className={row.url ? styles.url : styles.urlEmpty} title={row.url || undefined}>{urlLabel(row.url)}</span>
                    )}
                  </span>
                  <span role="cell" className={styles.cell}>{checkedLabel(row.checkedAt)}</span>
                  <span role="cell" className={styles.cell}>
                    <span className={styles.status} data-status={row.status}>{LINK_STATUS_LABEL[row.status]}</span>
                  </span>
                  <span role="cell" className={styles.actions}>
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
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {notice ? <p className={styles.footDanger}>{notice}</p> : null}
      {total > rows.length ? <p className={styles.foot}>{`ほか ${total - rows.length}件。`}</p> : null}
    </>,
  )
}
