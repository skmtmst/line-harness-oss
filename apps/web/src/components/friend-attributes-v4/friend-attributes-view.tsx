'use client'

import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import styles from './friend-attributes-view.module.css'

export type FriendAttributesTone = 'green' | 'orange' | 'gray'

export interface FriendAttributesKpiView {
  label: string
  value: string
  note: string
}

export interface FriendAttributesFolderView {
  id: string
  name: string
  count: number
  color: string
}

export interface FriendAttributesLinkView {
  label: string
  tone: FriendAttributesTone
}

export interface FriendAttributesRowView {
  id: string
  tag: string
  folderId: string
  folder: string
  folderColor: string
  count: string
  source: string
  links: FriendAttributesLinkView[]
  usage: string
  date: string
  starred: boolean
  editHref: string
}

export interface FriendAttributesViewProps {
  kpis: FriendAttributesKpiView[]
  folders: FriendAttributesFolderView[]
  rows: FriendAttributesRowView[]
  totalCount: number
  filteredCount: number
  rangeStart: number
  rangeEnd: number
  activeFolderId: string
  query: string
  usageFilter: string
  sourceFilter: string
  quickFilter: string
  pageSize: number
  currentPage: number
  totalPages: number
  loading?: boolean
  error?: string
  deletingTag?: string
  deleteConfirmation?: string
  deleteBusy?: boolean
  onFolderSelect?: (id: string) => void
  onQueryChange?: (value: string) => void
  onUsageFilterChange?: (value: string) => void
  onSourceFilterChange?: (value: string) => void
  onQuickFilterChange?: (value: string) => void
  onPageSizeChange?: (value: number) => void
  onPageChange?: (value: number) => void
  onCsvFile?: (file: File) => void
  onGroupChange?: (tagId: string, groupId: string) => void
  onToggleStar?: (tagId: string) => void
  onDeleteRequest?: (tagId: string) => void
  onDeleteCancel?: () => void
  onDeleteConfirmationChange?: (value: string) => void
  onDeleteConfirm?: () => void
  onDragStart?: (tagId: string) => void
  onDrop?: (tagId: string) => void
}

function Control({ children, accent = false, compact = false, disabled = false }: {
  children: ReactNode
  accent?: boolean
  compact?: boolean
  disabled?: boolean
}) {
  return (
    <span className={`${styles.button} ${accent ? styles.buttonAccent : ''} ${compact ? styles.buttonCompact : ''} ${disabled ? styles.buttonDisabled : ''}`}>
      {children}
    </span>
  )
}

const quickFilters = [
  ['unused', '未使用のタグ'],
  ['recent', '今月増えたタグ'],
  ['linked', '自動付与あり'],
  ['action', '連動あり'],
  ['starred', '★一覧表示'],
] as const

const pageSizes = [[20, '20件表示'], [30, '30件表示'], [40, '40件表示'], [50, '50件表示']] as const

export default function FriendAttributesView(props: FriendAttributesViewProps) {
  const interactive = Boolean(props.onFolderSelect)
  const handleCsv = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) props.onCsvFile?.(file)
    event.target.value = ''
  }

  return (
    <div className={styles.screen} data-design-node="xn98K" data-design-version="friend-attributes-v4-props-view">
      <div className={styles.page}>
        <header className={styles.header} data-design="Head">
          <div><h1>友だち属性</h1><p>タグ・情報欄・対応マーク・保存条件を、用途まで見ながら管理します。</p></div>
          <div className={styles.headerActions}>
            <Control disabled><button type="button" disabled>マニュアル</button></Control>
            <Control>
              <label>CSVで一括登録<input className={styles.visuallyHidden} type="file" accept=".csv,text/csv" onChange={handleCsv} disabled={!props.onCsvFile} /></label>
            </Control>
          </div>
        </header>

        <div className={styles.tabs} data-design="Tabs">
          <button type="button" className={styles.tabActive}>タグ</button>
          <button type="button" disabled title="次の画面移植で接続します">友だち情報欄</button>
          <button type="button" disabled title="次の画面移植で接続します">対応マーク</button>
          <button type="button" disabled title="次の画面移植で接続します">保存した検索</button>
        </div>

        <section className={styles.kpis} data-design="KPIs">
          {props.kpis.map((kpi) => <article key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small></article>)}
        </section>

        {props.error ? <p className={styles.error}>{props.error}</p> : null}

        <div className={styles.primaryActions} data-design="Actions">
          <a className={styles.button} href="/tags/folders/new">フォルダを追加</a>
          <a className={`${styles.button} ${styles.buttonAccent}`} href="/tags/new">＋ タグを追加</a>
        </div>

        <section className={styles.workspace}>
          <aside className={styles.folderPanel} data-design="Folder">
            <div className={styles.folderTitle}><strong>フォルダ</strong><span>{props.totalCount}件</span></div>
            <div className={styles.folderList}>
              {props.folders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className={folder.id === props.activeFolderId ? styles.folderActive : ''}
                  onClick={() => props.onFolderSelect?.(folder.id)}
                  disabled={!interactive}
                >
                  <span className={styles.dot} style={{ backgroundColor: folder.color }} /><span title={folder.name}>{folder.name}</span><b>{folder.count}</b>
                </button>
              ))}
            </div>
            <p className={styles.folderNote}>フォルダを削除しても、中の項目は未分類に残ります。</p>
          </aside>

          <div className={styles.listArea}>
            <div className={styles.toolbar} data-design="Toolbar">
              <div>
                <input className={`${styles.button} ${styles.searchInput}`} type="search" value={props.query} onChange={(event) => props.onQueryChange?.(event.target.value)} placeholder="タグ名・用途で検索" readOnly={!props.onQueryChange} />
                <select className={`${styles.button} ${styles.buttonCompact}`} value={props.usageFilter} onChange={(event) => props.onUsageFilterChange?.(event.target.value)} disabled={!props.onUsageFilterChange}><option value="all">使用状態：すべて</option><option value="unused">未使用</option><option value="linked">連動あり</option></select>
                <select className={`${styles.button} ${styles.buttonCompact}`} value={props.sourceFilter} onChange={(event) => props.onSourceFilterChange?.(event.target.value)} disabled={!props.onSourceFilterChange}><option value="all">付与元：すべて</option><option value="manual">手動のみ</option><option value="automatic">自動付与あり</option></select>
              </div>
              <div className={styles.countControl}>
                <select className={`${styles.button} ${styles.buttonCompact}`} value={props.pageSize} onChange={(event) => props.onPageSizeChange?.(Number(event.target.value))} disabled={!props.onPageSizeChange}>{pageSizes.map(([size, label]) => <option key={size} value={size}>{label}</option>)}</select>
                <span>{props.filteredCount === 0 ? 0 : `${props.rangeStart}〜${props.rangeEnd}`} / {props.filteredCount}件</span>
              </div>
            </div>
            <div className={styles.quickFilters} data-design="QuickFilters">
              <span>よく使う</span>
              {quickFilters.map(([key, label]) => <button type="button" key={key} className={props.quickFilter === key ? styles.quickActive : ''} onClick={() => props.onQuickFilterChange?.(props.quickFilter === key ? '' : key)} disabled={!props.onQuickFilterChange}>{label}</button>)}
            </div>

            <div className={styles.table} data-design="Table">
              <div className={`${styles.tableGrid} ${styles.tableHeader}`}><span /><span>タグ</span><span>フォルダ</span><span>付与人数</span><span>自動付与のもと</span><span title="連動（マイル・アクション）">連動（マイル・アクション）</span><span>使用先</span><span>登録日</span><span>表示</span><span>操作</span></div>
              {props.loading ? <div className={styles.tableMessage}>読み込み中…</div> : props.rows.length === 0 ? <div className={styles.tableMessage}>条件に合うタグはありません</div> : props.rows.map((row) => (
                <div className={`${styles.tableGrid} ${styles.tableRow}`} key={row.id} onDragOver={(event: DragEvent<HTMLDivElement>) => interactive && event.preventDefault()} onDrop={() => props.onDrop?.(row.id)}>
                  <button type="button" draggable={interactive} onDragStart={() => props.onDragStart?.(row.id)} className={styles.drag} aria-label={`${row.tag}を並べ替え`}>⠿</button>
                  <strong title={row.tag}>{row.tag}</strong>
                  <span className={styles.folderBadge}><i className={styles.dot} style={{ backgroundColor: row.folderColor }} /><select aria-label={`${row.tag}のフォルダ`} value={row.folderId} onChange={(event) => props.onGroupChange?.(row.id, event.target.value)} disabled={!props.onGroupChange}><option value="">未分類</option>{props.folders.filter((folder) => folder.id !== '' && folder.id !== '__ungrouped__').map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><small>⌄</small></span>
                  <span>{row.count}</span><span title={row.source}>{row.source}</span>
                  <span className={styles.linkBadges}>{row.links.length ? row.links.map((link) => <b key={`${row.id}-${link.label}`} className={styles[link.tone]}>{link.label}</b>) : <em>—</em>}</span>
                  <span title={row.usage}>{row.usage}</span><span>{row.date}</span>
                  <button type="button" className={styles.starButton} onClick={() => props.onToggleStar?.(row.id)} disabled={!props.onToggleStar}>{row.starred ? '★ 一覧' : '—'}</button>
                  <span className={styles.rowActions}><a href={row.editHref}>編集</a><button type="button" onClick={() => props.onDeleteRequest?.(row.id)} disabled={!props.onDeleteRequest}>削除</button></span>
                </div>
              ))}
            </div>
            <div className={styles.pagination} data-design="Pagination">
              <button type="button" disabled={!props.onPageChange || props.currentPage <= 1} onClick={() => props.onPageChange?.(props.currentPage - 1)}>前へ</button>
              <b>{props.currentPage}</b><span>/ {props.totalPages}</span>
              <button type="button" disabled={!props.onPageChange || props.currentPage >= props.totalPages} onClick={() => props.onPageChange?.(props.currentPage + 1)}>次へ</button>
            </div>
          </div>
        </section>
      </div>

      {props.deletingTag ? (
        <div className={styles.dialogBackdrop}>
          <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-tag-title">
            <h2 id="delete-tag-title">「{props.deletingTag}」を削除しますか？</h2>
            <p>削除すると元に戻せません。確認のためタグ名を入力してください。</p>
            <input value={props.deleteConfirmation ?? ''} onChange={(event) => props.onDeleteConfirmationChange?.(event.target.value)} aria-label="削除するタグ名" />
            <div><button type="button" onClick={props.onDeleteCancel}>キャンセル</button><button type="button" className={styles.dangerButton} disabled={props.deleteBusy || props.deleteConfirmation !== props.deletingTag} onClick={props.onDeleteConfirm}>{props.deleteBusy ? '削除中…' : '削除する'}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
