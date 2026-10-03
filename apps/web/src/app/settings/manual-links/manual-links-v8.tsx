'use client'

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
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
    statusFilters,
  } = useManualLinks()

  if (status !== 'ready') {
    return (
      <SettingsShellV8
        title="マニュアルの正本表"
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
        <Select
          aria-label="リンクの状態"
          value={filter}
          onChange={(value) => setFilter(value as typeof filter)}
          options={statusFilters.map((f) => ({ value: f.value, label: `状態：${f.label}` }))}
        />
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
          <table>
            <colgroup>
              <col style={{ width: '9%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>画面ID</th>
                <th>画面名</th>
                <th>公式記事のURL</th>
                <th>最後に確かめた日</th>
                <th>リンクの状態</th>
                <th className={styles.tdRight}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const key = row.taskId ?? row.screenId
                const editing = editingKey === key
                return (
                  <tr key={key}>
                    <td>{row.screenId}</td>
                    <td>{row.name}</td>
                    <td>
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
                    </td>
                    <td className={styles.nowrap}>{checkedLabel(row.checkedAt)}</td>
                    <td>
                      <span
                        className={`${styles.statusChip} ${
                          row.status === 'ok'
                            ? styles.statusOk
                            : row.status === 'broken'
                              ? styles.statusDanger
                              : styles.statusNeutral
                        }`}
                      >
                        {LINK_STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className={styles.tdRight}>
                      {editing ? (
                        <>
                          <Button variant="secondary" disabled={saving} onClick={cancelEdit}>キャンセル</Button>{' '}
                          <Button variant="primary" disabled={saving} onClick={() => void saveEdit()}>決める</Button>
                        </>
                      ) : (
                        <Button variant="secondary" onClick={() => startEdit(key)}>直す</Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.footNote}>
        {total > rows.length ? `ほか ${total - rows.length}件。` : ''}{VERIFY_SCHEDULE_NOTE}
      </p>
    </SettingsShellV8>
  )
}
