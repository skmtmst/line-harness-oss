'use client'

import { useContext, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Check, Inbox, X } from 'lucide-react'
import Button from './button'
import IconButton from './icon-button'
import FilterChip from './filter-chip'
import { FolderDot } from './folder-dot'
import Radio from './radio'
import SearchField from './search-field'
import Select from './select'
import StatusBadge, { type StatusBadgeTone } from './status-badge'
import { OverlayDepthContext, useOverlayFocus } from './overlay-utils'
import styles from './source-picker-dialog.module.css'

export interface SourcePickerItem {
  id: string
  name: string
  category: string
  categoryLabel: string
  tone?: StatusBadgeTone
  folderId?: string | null
  updatedLabel: string
}
export interface SourcePickerFolder { id: string; name: string; color?: string | null }
export interface SourcePickerCategory { id: string; label: string }

/** EpTBB：候補を選ぶ間は仮選択。使う操作だけが作成中の内容を変える。 */
export default function SourcePickerDialog({
  title, description, confirmLabel, items, folders, categories, initialId = '',
  state, preview, error, busy = false, confirmDisabled = false,
  onSelect, onConfirm, onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  items: SourcePickerItem[]
  folders: SourcePickerFolder[]
  categories: SourcePickerCategory[]
  initialId?: string
  state?: ReactNode
  preview: ReactNode
  error?: string
  busy?: boolean
  confirmDisabled?: boolean
  onSelect: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
}) {
  const id = useId()
  const depth = useContext(OverlayDepthContext)
  const [mounted, setMounted] = useState(false)
  const [selected, setSelected] = useState(initialId)
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(20)
  const [narrow, setNarrow] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useOverlayFocus(mounted, onCancel, busy, () => searchRef.current)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 1100))
    observer.observe(panel)
    return () => observer.disconnect()
  }, [mounted, panelRef])
  useEffect(() => { setLimit(20) }, [query, folder, category])

  const folderItems = items.filter((item) => !folder || (folder === '__none__' ? !item.folderId : item.folderId === folder))
  const rows = folderItems.filter((item) => (!category || item.category === category) && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const picked = items.find((item) => item.id === selected)
  const folderOptions = [{ id: '', name: 'すべて' }, ...folders, { id: '__none__', name: '未分類' }]
  const countFolder = (folderId: string) => items.filter((item) => !folderId || (folderId === '__none__' ? !item.folderId : item.folderId === folderId)).length
  const listState = Boolean(state)
  const choose = (itemId: string) => { setSelected(itemId); onSelect(itemId) }
  const panel = <div className={styles.overlay} onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy || undefined} tabIndex={-1} className={styles.panel} data-design-node="EpTBB">
      <header className={styles.header}>
        <div className={styles.heading}><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p></div>
        <SearchField ref={searchRef} aria-label={`${title}：名前で探す`} placeholder="名前で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
        <IconButton aria-label="閉じる" title="閉じる" disabled={busy} onClick={onCancel}><X size={18} aria-hidden /></IconButton>
      </header>
      <div className={styles.body}>
        {!narrow ? <nav className={styles.folders} aria-label="候補のフォルダ">
          <p>フォルダ</p>
          {folderOptions.map((f) => <button type="button" key={f.id} aria-pressed={folder === f.id} className={styles.folder} disabled={busy || listState} onClick={() => setFolder(f.id)}>
            {f.id ? <FolderDot folder={folders.find((entry) => entry.id === f.id)} /> : <Inbox size={14} aria-hidden />}<span title={f.name}>{f.name}</span><small>{listState ? '—' : countFolder(f.id)}</small>
          </button>)}
        </nav> : null}
        <section className={styles.list} aria-label="候補の一覧">
          {narrow ? <Select aria-label="候補のフォルダ" value={folder} onChange={setFolder} options={folderOptions.map((f) => ({ value: f.id, label: `${f.name}（${listState ? '—' : countFolder(f.id)}）` }))} /> : null}
          <div className={styles.categories} aria-label="候補の絞り込み">
            {[{ id: '', label: 'すべて' }, ...categories].map((c) => <FilterChip key={c.id} selected={category === c.id} disabled={busy || listState} count={listState ? undefined : folderItems.filter((item) => !c.id || item.category === c.id).length} onChange={() => setCategory(c.id)}>{c.label}</FilterChip>)}
          </div>
          <div className={styles.rows} onScroll={(event) => {
            const target = event.currentTarget
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 80) setLimit((value) => Math.min(value + 20, rows.length))
          }}>
            {state || (rows.length ? rows.slice(0, limit).map((item) => <div key={item.id} className={styles.row} data-selected={selected === item.id || undefined}>
              <Radio fill aria-label={item.name} name={`${id}-selection`} value={item.id} checked={selected === item.id} onChange={() => choose(item.id)} disabled={busy}>
                <span className={styles.rowContent}>
                  <span className={styles.categoryCell}><StatusBadge tone={item.tone} dot={false} size="compact">{item.categoryLabel}</StatusBadge></span>
                  <span className={styles.itemName}><strong><FolderDot folder={folders.find((f) => f.id === item.folderId)} /><span className={styles.nameText} title={item.name}>{item.name}</span></strong></span>
                  {/* EpTBBは名前・フォルダ・更新日を横に並べる指定。通常の一覧とは別の選択窓。 */}
                  <small className={styles.folderLabel} title={folderName(item.folderId, folders)}>{folderName(item.folderId, folders)}</small>
                  <small className={styles.date}>{item.updatedLabel}</small>
                </span>
              </Radio>
            </div>) : <p className={styles.empty}>当てはまる候補がありません。</p>)}
          </div>
          {!listState ? <div className={styles.more}><span>{`${rows.length}件中 ${rows.length ? 1 : 0}〜${Math.min(limit, rows.length)}件`}</span>{rows.length > limit ? <Button size="compact" onClick={() => setLimit((value) => value + 20)}>続きを読み込む</Button> : null}</div> : null}
        </section>
        {!narrow ? <aside className={styles.preview} aria-label="選んだ候補の見え方">{preview}</aside> : null}
      </div>
      {narrow ? <details className={styles.compactPreview}><summary>選んだ候補の LINE での見え方</summary>{preview}</details> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.footer}>
        <span className={styles.selection} title={picked?.name}>{picked ? `選んだもの：${picked.name}（${picked.categoryLabel}）` : '選んだもの：まだ選んでいません'}</span>
        <Button disabled={busy} onClick={onCancel}>キャンセル</Button>
        <Button variant="primary" busy={busy} disabled={busy || !picked || listState || confirmDisabled} onClick={() => onConfirm(selected)}><Check size={16} aria-hidden />{confirmLabel}</Button>
      </footer>
    </div>
  </div>
  return <OverlayDepthContext.Provider value={depth + 1}>{mounted ? createPortal(panel, document.body) : null}</OverlayDepthContext.Provider>
}

function folderName(id: string | null | undefined, folders: SourcePickerFolder[]) {
  return id ? folders.find((f) => f.id === id)?.name ?? '—' : '未分類'
}

/** ①の選び終えた候補。長い名前でも1行の高さを保つ。 */
export function SourcePickerSelection({ item, folders, onChange, buttonRef }: { item: SourcePickerItem; folders: SourcePickerFolder[]; onChange: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return <div className={styles.selectedRow}>
    <StatusBadge tone={item.tone} dot={false} size="compact">{item.categoryLabel}</StatusBadge>
    <span className={styles.itemName}><strong><span className={styles.nameText} title={item.name}>{item.name}</span></strong></span>
    <small className={styles.selectedMeta} title={`${folderName(item.folderId, folders)}・${item.updatedLabel}`}>{`${folderName(item.folderId, folders)}・${item.updatedLabel}`}</small>
    <Button ref={buttonRef} size="compact" onClick={onChange}>選び直す</Button>
  </div>
}
