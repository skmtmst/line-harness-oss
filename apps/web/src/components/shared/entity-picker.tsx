'use client'

import { ChevronRight } from 'lucide-react';
import { folderDisplayColor } from './folder-dot';
import { useFieldContext } from './field-context';
import { joinDescribedBy } from './field-context'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, type LucideIcon } from 'lucide-react'
import Button from './button'
import Checkbox from './checkbox'
import FilterChip from './filter-chip'
import { FolderDot } from './folder-dot'
import FolderPanel, { type FolderPanelRow } from './folder-panel'
import Radio from './radio'
import SearchField from './search-field'
import Select from './select'
import StatusBadge, { type StatusBadgeTone } from './status-badge'
import SelectionDialog from './selection-dialog'
import shell from './source-picker-dialog.module.css'
import styles from './entity-picker.module.css'
import Dialog from './dialog'
import TagPill from './tag-pill'

/*
 * 受信箱の幅640の器を、作ってあるものを選ぶ窓へ共通化（B-155・163・164・165・175）。
 * 行の選択は下書きで、確定したときだけ呼び出し元へ返す。
 * 欄全体で開き、複数選択の札は窓を開かず外せる。作成先は下の文字リンク。
 */

export interface EntityPickerItem {
  id: string
  name: string
  /** 置き場のフォルダ。null は未分類。undefined はフォルダを持たない種類。 */
  folderId?: string | null
  /** 種類の札（テキスト・カルーセル など）。渡した窓だけ札の列と絞り込みを出す。 */
  category?: string
  categoryLabel?: string
  tone?: StatusBadgeTone
  /** 行の右の補足（「更新 10/8」「友だち 1,284」など）。 */
  meta?: string
  /** 名前のほかに探す言葉（LINE ID など）。 */
  keywords?: string
  /** 選べない行（停止中のアカウントなど）。理由は meta に書く。 */
  disabled?: boolean
  /** 必須の選択。まとめて解除・札の×でも外さない。 */
  locked?: boolean
  /** 行に見せる本文の抜粋。 */
  content?: string
  /** 利用実績のある候補。未取得は undefined のまま。 */
  frequent?: boolean
}
export interface EntityPickerFolder { id: string; name: string; color?: string | null }
export interface EntityPickerCategory { id: string; label: string }

/** フォルダの列の「すべて」「未分類」の値。 */
export const PICKER_ALL = ''
export const PICKER_UNFILED = '__none__'
const ALL = PICKER_ALL
const UNFILED = PICKER_UNFILED

function folderOf(item: EntityPickerItem, folders: EntityPickerFolder[]) {
  return item.folderId ? folders.find((folder) => folder.id === item.folderId) ?? null : null
}
function inFolder(item: EntityPickerItem, folder: string) {
  return !folder || (folder === UNFILED ? !item.folderId : item.folderId === folder)
}
function matches(item: EntityPickerItem, query: string) {
  const q = query.trim().toLocaleLowerCase()
  return !q || item.name.toLocaleLowerCase().includes(q) || Boolean(item.keywords?.toLocaleLowerCase().includes(q)) || Boolean(item.content?.toLocaleLowerCase().includes(q))
}

/** 窓の幅が狭いときはフォルダの列を選ぶ欄に畳む（白い板 1100px 未満で畳む決まりに合わせる）。 */
function useNarrow(threshold: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < threshold))
    observer.observe(node)
    return () => observer.disconnect()
  })
  return [ref, narrow] as const
}

function CreateLink({ href, label }: { href?: string; label?: string }) {
  if (!href || !label) return null
  return <Link className={styles.createLink} href={href} target="_blank" rel="noopener">{`作る画面へ：${label}`}<ArrowUpRight size={13} aria-hidden="true" /></Link>
}

type SingleProps = {
  title: string
  /** 窓の頭の説明。省くと題だけ。 */
  description?: string
  /** 主ボタンの文字。既定は「選ぶ」。 */
  confirmLabel?: string
  items: EntityPickerItem[]
  folders?: EntityPickerFolder[]
  /** フォルダを読み込めなかったとき。列は「すべて」だけにし、そう書く。 */
  foldersFailed?: boolean
  categories?: EntityPickerCategory[]
  query?: string
  onQueryChange?: (query: string) => void
  initialId?: string
  /** 一覧の代わりに出す状態（読み込み中・失敗）。 */
  listFooter?: ReactNode
  state?: ReactNode
  /** 右の中身の見本。渡さない種類は見本の列を出さず、真ん中を広くする。 */
  preview?: ReactNode | ((item: EntityPickerItem | null) => ReactNode)
  error?: string
  busy?: boolean
  confirmDisabled?: boolean
  readOnly?: boolean
  createHref?: string
  createLabel?: string
  searchPlaceholder?: string
  designNode?: string
  createAction?: { label: (query: string) => string; onCreate: (query: string) => void }
  onSelect?: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
}

/** B-165：受信箱とすべての選ぶ窓が共有する640pxの器。 */
export type EntityPickerWindowProps = {
  title: string
  description?: string
  onCancel: () => void
  busy?: boolean
  error?: string
  designNode?: string
  initialFocusId?: string
  /** データ取得を呼ぶ側で管理するときの中身。窓の形は共通のまま。 */
  children: ReactNode
  footer: ReactNode
  band?: ReactNode
}
export function EntityPickerDialog(props: SingleProps | EntityPickerWindowProps) {
  if ('children' in props) return <Dialog open title={props.title} description={props.description}
    designNode={props.designNode} designWidth={640} designHeaderPadding="var(--tpl-inbox-tp-head-pad)"
    busy={props.busy} initialFocusId={props.initialFocusId} onCancel={props.onCancel}
    footer={<>
      {props.children}
      {props.error ? <p className={styles.tpError} role="alert">{props.error}</p> : null}
      {props.band}
      <div className={styles.tpFoot}>{props.footer}</div>
    </>} />
  return <SingleEntityPickerDialog {...props} />
}

/** 行を選ぶ間は仮の選択。確定したときだけ呼ぶ側の値を変える。 */
function SingleEntityPickerDialog({
  title, description, confirmLabel = '選ぶ', items, folders = [], foldersFailed = false, categories = [], initialId = '',
  state, listFooter, preview, error, busy = false, confirmDisabled = false, readOnly = false, createHref, createLabel,
  searchPlaceholder = '名前で探す', designNode = 'M0393', query: controlledQuery, onQueryChange, createAction, onSelect, onConfirm, onCancel,
}: SingleProps) {
  const id = useId()
  const [selected, setSelected] = useState(initialId)
  const [ownQuery, setOwnQuery] = useState('')
  const query = controlledQuery ?? ownQuery
  const setQuery = (value: string) => { setOwnQuery(value); onQueryChange?.(value) }
  const [folder, setFolder] = useState(ALL)
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(20)
  useEffect(() => { setLimit(20) }, [query, folder, category])

  const hasFolders = folders.length > 0 || items.some((item) => item.folderId !== undefined)
  const listState = Boolean(state)
  const folderItems = items.filter((item) => folder === '__frequent__' ? item.frequent : inFolder(item, folder))
  const rows = folderItems.filter((item) => (!category || item.category === category) && (controlledQuery !== undefined || matches(item, query)))
  const visibleLimit = controlledQuery !== undefined ? rows.length : limit
  const picked = items.find((item) => item.id === selected) ?? null
  const folderRows = pickerFolderRows(items, folders, listState)
  if (items.some((item) => item.frequent !== undefined)) folderRows.unshift ({id: '__frequent__', label: 'よく使う', kind: 'folder', count: listState ? null : items.filter((item) => item.frequent).length })
  const previewNode = typeof preview === 'function' ? preview(picked) : preview

  return <EntityPickerDialog title={title} description={description} size="picker-narrow" busy={busy} error={error} designNode={designNode} onCancel={onCancel} initialFocusId={`${id}-search`}
    footer={<>
      <div className={styles.tpFootLead}>
        {!readOnly ?
      <CreateLink href={createHref} label={createLabel} /> : null}
      <span className={styles.selection} title={picked?.name}>{picked ? `選んだもの：${picked.name}` : 'まだ選んでいません'}</span>
      </div>
      <div className={styles.tpFootActions}>
      <Button disabled={busy} onClick={onCancel}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
      {readOnly ? null : <Button variant="primary" busy={busy} disabled={busy || !picked || picked.disabled || listState || confirmDisabled} onClick={() => onConfirm(selected)}><Check size={16} aria-hidden />{confirmLabel}</Button>}
    </div>
    </>}
  >
    <div className={styles.tpBody}>
      {hasFolders ? <div className={styles.tpSide}>
        <FolderPanel readOnly disabled={busy || listState} rows={folderRows} activeId={folder} onSelect={setFolder} />
      </div> : null}
      <section className={styles.tpList} aria-label="候補の一覧"> <SearchField id={`${id}-search`} aria-label={`${title}：${searchPlaceholder}`} placeholder={searchPlaceholder} value={query} onChange={setQuery} onClear={() => setQuery('')} />
        {foldersFailed ? <p className={styles.note}>フォルダを読み込めませんでした。すべての候補から選べます。</p> : null}
        {categories.length ? <div className={shell.categories} aria-label="候補の絞り込み">
          {[{ id: '', label: 'すべて' }, ...categories].map((c) => <FilterChip key={c.id} selected={category === c.id} disabled={busy || listState} count={listState ? undefined : folderItems.filter((item) => !c.id || item.category === c.id).length} onChange={() => setCategory(c.id)}>{c.label}</FilterChip>)}
        </div> : null}
        <div className={styles.tpCards}>
          {state || (rows.length ? rows.slice(0, visibleLimit).map((item) => <label key={item.id} className={styles.tpCard} data-selected={selected === item.id || undefined} data-disabled={busy || item.disabled || undefined}>
            <input type="radio" name={`${id}-candidate`} className={styles.cardRadio} aria-label={item.name} value={item.id} checked={selected === item.id} disabled={busy || item.disabled} onChange={() => { setSelected(item.id); onSelect?.(item.id) }} />
            {hasFolders ? <FolderDot folder={folderOf(item, folders)} /> : null}
            <span className={styles.tpCardText}>
              <span className={styles.tpCardName} title={item.name}>
                {item.name}</span>
              {item.content || item.meta ? <span className={styles.tpCardBody} title={item.content ?? item.meta}>{item.content ?? item.meta}</span> : null}
            </span>{item.categoryLabel ? <StatusBadge tone={item.tone} dot={false} size="compact">{item.categoryLabel}</StatusBadge> : null}</label>) : <p className={styles.tpNote}>当てはまる候補がありません。</p>)}
        </div>
        {createAction && !readOnly && query.trim() && !items.some((item) => item.name === query.trim()) ? <Button disabled={busy || listState} onClick={() => createAction.onCreate(query.trim())}>{createAction.label(query.trim())}</Button> : null}
        {!listState ? <div className={shell.more}><span>{`${rows.length}件中 ${rows.length ? 1 : 0}〜${Math.min(visibleLimit, rows.length)}件`}</span>{rows.length > visibleLimit ? <Button size="compact" onClick={() => setLimit((value) => value + 20)}>続きを読み込む</Button> : null}</div> : null}
      {listFooter}
        {preview !== undefined && picked ? <div className={styles.itemPreview} aria-label="選んだ候補の見え方">{previewNode}</div> : null}
    </section></div></EntityPickerDialog>
}

/** フォルダの列の行（すべて・各フォルダ・未分類）。件数は候補の数。 */
export function pickerFolderRows(items: EntityPickerItem[], folders: EntityPickerFolder[], hideCounts = false, leading?: (ids: string[], label: string) => ReactNode): FolderPanelRow[] {
  const count = (folder: string) => (hideCounts ? null : items.filter((item) => inFolder(item, folder)).length)
  const ids = (folder: string) => items.filter((item) => inFolder(item, folder) && !item.disabled && !item.locked).map((item) => item.id)
  const showUnfiled = folders.length > 0 || items.some((item) => item.folderId === null)
  const rows: FolderPanelRow[] = [
    { id: ALL, label: 'すべて', kind: 'all', count: count(ALL) },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, kind: 'folder' as const, color: folder.color ?? null, count: count(folder.id) })),
    ...(showUnfiled ? [{ id: UNFILED, label: '未分類', kind: 'unfiled' as const, count: count(UNFILED) }] : []),
  ]
  return leading ? rows.map((row) => ({ ...row, leading: leading(ids(row.id), row.label) })) : rows
}

type MultiBodyProps = {
  items: EntityPickerItem[]
  folders?: EntityPickerFolder[]
  foldersFailed?: boolean
  selected: string[]
  onChange: (ids: string[]) => void
  query: string
  /** 選んだものだけ見る。 */
  onlySelected?: boolean
  readOnly?: boolean
  busy?: boolean
  listFooter?: ReactNode
  state?: ReactNode
  /** 行の右の状態（接続の状態など）。 */
  rowExtra?: (item: EntityPickerItem) => ReactNode
  /** 窓の外（メンバーの窓など）に埋め込むとき、探す欄を中に置く。 */
  searchSlot?: ReactNode
  listLabel?: string
  /** フォルダの絞り込みを呼ぶ側で持つとき（URL の ?folder= など）。 */
  folder?: string
  onFolder?: (id: string) => void
  /** フォルダの列の見出し。 */
  folderHeading?: string
  /** 開いたときに絞っておくフォルダ。 */
  initialFolder?: string
  /** ほかの窓の中に埋め込むとき。高さを決めて一覧だけを送る。 */
  embedded?: boolean
}

/**
 * まとめて選ぶ中身（フォルダの列＋一覧）。窓の中にも、ほかの窓の中にも埋め込める。
 * フォルダの横のチェックは、そのフォルダの選べる候補をまとめて付け外しする。
 */
export function EntityMultiSelect({ items, folders = [], foldersFailed = false, selected, onChange, query, onlySelected = false, readOnly = false, busy = false, state, listFooter, rowExtra, searchSlot, listLabel = '候補の一覧', folder: controlledFolder, onFolder, folderHeading, initialFolder, embedded = false }: MultiBodyProps) {
  const id = useId()
  const [ownFolder, setOwnFolder] = useState(initialFolder ?? ALL)
  const folder = controlledFolder ?? ownFolder
  const setFolder = (value: string) => { setOwnFolder(value); onFolder?.(value) }
  const [panelRef, narrow] = useNarrow(560)
  const hasFolders = folders.length > 0 || items.some((item) => item.folderId !== undefined)
  const set = useMemo(() => new Set(selected), [selected])
  const toggleMany = (ids: string[], on: boolean) => onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((value) => !ids.includes(value)))
  const groupCheck = (ids: string[], label: string) => {
    const count = ids.filter((value) => set.has(value)).length
    return <Checkbox aria-label={`${label}をまとめて選ぶ`} checked={ids.length > 0 && count === ids.length} indeterminate={count > 0 && count < ids.length}
      disabled={readOnly || busy || ids.length === 0} onCheckedChange={(on) => toggleMany(ids, on)} />
  }
  const folderRows = pickerFolderRows(items, folders, Boolean(state), groupCheck)
  const rows = items.filter((item) => inFolder(item, folder) && matches(item, query) && (!onlySelected || set.has(item.id)))
  return <div ref={panelRef} className={embedded ? `${styles.tpBody} ${styles.embedded}` : styles.tpBody}>
    {hasFolders && !narrow ? <div className={styles.tpSide}>
      <FolderPanel readOnly heading={folderHeading} disabled={busy || Boolean(state)} rows={folderRows} activeId={folder} onSelect={setFolder} />
    </div> : null}
    <section className={`${styles.tpList} ${styles.multiList}`} aria-label={listLabel}>
      {searchSlot}
      {hasFolders && narrow ? <Select disabled={busy || Boolean(state)} aria-label="候補のフォルダ" value={folder} onChange={setFolder} options={folderRows.map((row) => ({ value: row.id, label: `${row.label}（${row.count ?? '—'}）` }))} /> : null}
      {foldersFailed ? <p className={styles.note}>フォルダを読み込めませんでした。すべての候補から選べます。</p> : null}
      <div className={styles.multiRows}>
        {state || (rows.length ? rows.map((item) => {
          const checked = set.has(item.id)
          const inputId = `${id}-${item.id}`
          return <div key={item.id} className={styles.multiRow} data-selected={checked || undefined} data-disabled={item.disabled || undefined}>
            <Checkbox id={inputId} aria-label={item.name} checked={checked} disabled={readOnly || busy || item.locked || (item.disabled && !checked)} onCheckedChange={(on) => toggleMany([item.id], on)} />
            <label className={styles.multiName} htmlFor={inputId} title={item.name}>
              {hasFolders ? <FolderDot folder={folderOf(item, folders)} /> : null}
              <span className={styles.multiNameText}>{item.name}</span>
            </label>
            {rowExtra ? <span className={styles.multiExtra}>{rowExtra(item)}</span> : null}
            {item.meta ? <small className={styles.multiMeta} title={item.meta}>{item.meta}</small> : null}
          </div>
        }) : <p className={shell.empty}>{onlySelected ? 'まだ何も選んでいません。' : '当てはまる候補がありません。'}</p>)}
      </div>
      {listFooter}
    </section>
  </div>
}

type MultiProps = {
  title: string
  description?: string
  items: EntityPickerItem[]
  folders?: EntityPickerFolder[]
  foldersFailed?: boolean
  initialIds: string[]
  query?: string
  onQueryChange?: (query: string) => void
  maxSelected?: number
  /** 数の単位（「アカウント」「件」）。 */
  unit?: string
  listFooter?: ReactNode
  state?: ReactNode
  error?: string
  busy?: boolean
  readOnly?: boolean
  createHref?: string
  createLabel?: string
  searchPlaceholder?: string
  /** 1件も選ばずに確定してよいか（タグを全部外す など）。 */
  allowEmpty?: boolean
  rowExtra?: (item: EntityPickerItem) => ReactNode
  initialFolder?: string
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}

/** まとめて選ぶ窓。確定するまでは呼ぶ側の値を変えない。 */
export function EntityMultiPickerDialog({ title, description, items, folders, foldersFailed, initialIds, unit = '件', state, listFooter, error, busy = false, readOnly = false, createHref, createLabel, searchPlaceholder = '名前で探す', allowEmpty = true, rowExtra, initialFolder, query: controlledQuery, onQueryChange, maxSelected, onConfirm, onCancel }: MultiProps) {
  const [selected, setSelected] = useState(initialIds)
  const [ownQuery, setOwnQuery] = useState('')
  const query = controlledQuery ?? ownQuery
  const setQuery = (value: string) => { setOwnQuery(value); onQueryChange?.(value) }
  const [onlySelected, setOnlySelected] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sep = unit === '件' ? '' : ' '
  const countText = `${selected.length}${sep}${unit}`
  return <EntityPickerDialog title={title} description={description} designNode="dJZ7Q" busy={busy} error={error} onCancel={onCancel}
    footer={<>
      <div className={styles.tpFootLead}>
        {!readOnly ?
      <CreateLink href={createHref} label={createLabel} /> : null}
      <span className={styles.tpFootText} aria-live="polite">
          <span className=
        {styles.tpFootTitle}>{`${countText}を選んでいます`}</span>
        <button type="button" className={styles.textButton} aria-pressed={onlySelected} onClick={() => setOnlySelected((value) => !value)}>{onlySelected ? 'すべて見る' : '選んだものだけ見る'}</button>
      </span>
      </div>
      <div className={styles.tpFootActions}>
        <Button disabled={busy} onClick={onCancel}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
      {readOnly ? null : <Button variant="primary" busy={busy} disabled={busy || Boolean(state) || (maxSelected !== undefined && selected.length > maxSelected) || (!allowEmpty && selected.length === 0)} onClick={() => onConfirm(selected)}>{`この${sep || ' '}${countText}にする`}</Button>}
    </div>
    </>}
  >
    <EntityMultiSelect items={maxSelected && selected.length >= maxSelected ? items.map((item) => ({ ...item, disabled: item.disabled || !selected.includes(item.id) })) :items} folders={folders} foldersFailed={foldersFailed} selected={selected} onChange={setSelected} query={query} onlySelected={onlySelected} readOnly={readOnly} busy={busy} state={state} listFooter={listFooter} rowExtra={rowExtra} initialFolder={initialFolder}
      searchSlot={<SearchField ref={searchRef} aria-label={`${title}：${searchPlaceholder}`} placeholder={searchPlaceholder} value={query} onChange={setQuery} onClear={() => setQuery('')} />} />
  </EntityPickerDialog>
}

type FieldBase = {
  /** 欄の名前（読み上げと窓の題に使う）。 */
  label: string
  /** 何を選ぶか（「テンプレート」）。窓の題「〇〇を選ぶ」と空のときの文に使う。 */
  noun: string
  icon?: LucideIcon
  items: EntityPickerItem[]
  folders?: EntityPickerFolder[]
  foldersFailed?: boolean
  /** 窓を開いたときに読み込む（フォルダ・最新の候補）。 */
  onOpen?: () => void
  /** 候補を読み込んでいる・失敗したときの窓の中身。 */
  listFooter?: ReactNode
  state?: ReactNode
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  invalid?: boolean
  createHref?: string
  createLabel?: string
  /** 窓の頭の説明。 */
  description?: string
  /** 窓の題（既定は「〇〇を選ぶ」）。 */
  title?: string
  searchPlaceholder?: string
  id?: string
  buttonRef?: Ref<HTMLButtonElement>
  describedBy?: string
  'aria-describedby'?: string
  ariaLabel?: string
  defaultOpen?: boolean
  query?: string
  onQueryChange?: (query: string) => void
  maxSelected?: number
}
type SingleField = FieldBase & {
  multiple?: false
  value: string | null | undefined
  onChange: (id: string) => void
  /** 選ばない（空）に戻せる欄。「外す」を出す。 */
  clearable?: boolean
  categories?: EntityPickerCategory[]
  preview?: SingleProps['preview']
  confirmLabel?: string
  createAction?: SingleProps['createAction']
  onSelect?: (id: string) => void
  confirmDisabled?: boolean
}
type MultiField = FieldBase & {
  multiple: true
  value: string[]
  onChange: (ids: string[]) => void
  unit?: string
  allowEmpty?: boolean
  rowExtra?: (item: EntityPickerItem) => ReactNode
  /** 欄の補足（既定は名前を「・」でつなぐ）。 */
  summarize?: (items: EntityPickerItem[]) => string
}

/** 欄の1行だけ（窓は呼ぶ側が開く）。一括配信の送るアカウントのように窓を自前で持つ画面が使う。 */
export function EntityPickerSummary({ label, noun, icon: Icon, name, meta, placeholder, disabled = false, readOnly = false, invalid = false, id, buttonRef, describedBy, 'aria-describedby': ariaDescribedBy, onOpen, onClear, selection, ariaLabel }: {
  label: string; noun: string; icon?: LucideIcon
  name?: string; meta?: string; placeholder?: string
  disabled?: boolean; readOnly?: boolean; invalid?: boolean; id?: string
  buttonRef?: Ref<HTMLButtonElement>
  describedBy?: string
  'aria-describedby'?: string
  onOpen: () => void
  onClear?: () => void
  selection?: ReactNode
  ariaLabel?: string
}) {
  const field = useFieldContext()
  const empty = !name
  const actionLabel = readOnly ? '見る' : empty ? '選ぶ' : '変える'
  const isInvalid = invalid || Boolean(field?.invalid)
  return <div className={styles.field} data-empty={empty || undefined} data-invalid={isInvalid || undefined} data-disabled={disabled || undefined} data-multiple={selection ? '' : undefined}>
    {readOnly && empty ? null : <button type="button" className={styles.fieldTrigger} ref={buttonRef} id={id ?? field?.controlId}
      disabled={disabled} aria-label={ariaLabel ?? `${label}：${actionLabel}`} aria-haspopup="dialog"
      aria-invalid={isInvalid || undefined} aria-describedby={joinDescribedBy(describedBy, ariaDescribedBy, field?.describedBy)} onClick={onOpen} />}
    {Icon ? <Icon className={styles.fieldIcon} size={16} aria-hidden="true" /> : null}
    {selection ? <span className={styles.fieldChips}>{selection}</span> :
    <span className={styles.fieldValue}>
      {empty ? <span className={styles.fieldPlaceholder}>{placeholder ?? `${noun}を選ぶ`}</span> : <>
        <strong className={styles.fieldName} title={name}>{name}</strong>
        {meta ? <small className={styles.fieldMeta} title={meta}>{meta}</small> : null}
      </>}
    </span>}
    {onClear && !empty && !readOnly ? <button type="button" className={styles.fieldClear} disabled={disabled} aria-label={`${label}を外す`} onClick={onClear}>外す</button> : null}
    {readOnly && empty ? null : <span className={styles.fieldAction} aria-hidden="true"><ChevronRight size={16} /></span>}
  </div>
}

/** 選んでいるものの名前と補足（欄の1行に出す文）。 */
export function describePicked(items: EntityPickerItem[], folders: EntityPickerFolder[], value: string | string[] | null | undefined, unit = '件', summarize?: (items: EntityPickerItem[]) => string) {
  if (Array.isArray(value)) {
    if (!value.length) return { name: '', meta: '', missing: false }
    const chosen = items.filter((item) => value.includes(item.id))
    return { name: `${value.length}${unit === '件' ? '件' : ` ${unit}`}`, meta: summarize ? summarize(chosen) : chosen.map((item) => item.name).join('・'), missing: false }
  }
  if (!value) return { name: '', meta: '', missing: false }
  const item = items.find((candidate) => candidate.id === value)
  if (!item) return items.length ? { name: '見つかりません', meta: '消されたか、使えなくなりました。選び直してください。', missing: true } : { name: '読み込み中…', meta: '', missing: false }
  const folder = item.folderId ? folders.find((entry) => entry.id === item.folderId) : null
  return { name: item.name, meta: item.folderId === null ? 'フォルダ：未分類' : folder ? `フォルダ：${folder.name}` : item.meta ?? '', missing: false }
}

/** 画面の欄。「選んだもの（印・名前・補足）＋［選ぶ］／［変える］」の1行。押すと窓が開く。 */
export function EntityPickerField(props: SingleField | MultiField) {
  const { label, noun, icon, items, folders = [], foldersFailed, onOpen, state, placeholder, disabled = false, readOnly = false, invalid = false, createHref, createLabel, description, id, buttonRef, describedBy } = props
  const [open, setOpen] = useState(props.defaultOpen ??false)
  const title = props.title ?? `${noun}を選ぶ`
  const picked = describePicked(items, folders, props.value, props.multiple ? props.unit : undefined, props.multiple ? props.summarize : undefined)
  const close = () => setOpen(false)
  return <>
    <EntityPickerSummary label={label} noun={noun} icon={icon} name={picked.name} meta={picked.meta} placeholder={placeholder} disabled={disabled} readOnly={readOnly}
      ariaLabel={props.ariaLabel}
      selection={props.multiple && props.value.length ? props.value.map((value) => {
        const item = items.find((candidate) => candidate.id === value)
        const folder = item ? folderOf(item, folders) : null
        return <TagPill key={value} name={item?.name ?? '見つかりません'} color={folder ? folderDisplayColor(folder) : null}
          onRemove={readOnly || disabled || item?.locked ? undefined : () => props.onChange(props.value.filter((id) => id !== value))} />
      }) : undefined}
      invalid={invalid || picked.missing} id={id} buttonRef={buttonRef} describedBy={joinDescribedBy(describedBy, props['aria-describedby'])} onOpen={() => { onOpen?.(); setOpen(true) }}
      onClear={!props.multiple && props.clearable ? () => props.onChange('') : undefined} />
    {open ? props.multiple
      ? <EntityMultiPickerDialog title={title} description={description} items={items} folders={folders} foldersFailed={foldersFailed} initialIds={props.value} unit={props.unit} state={state} listFooter={props.listFooter} readOnly={readOnly}
        query={props.query} onQueryChange={props.onQueryChange} maxSelected={props.maxSelected}
        createHref={createHref} createLabel={createLabel} allowEmpty={props.allowEmpty} rowExtra={props.rowExtra} searchPlaceholder={props.searchPlaceholder}
        onCancel={close} onConfirm={(ids) => { props.onChange(ids); close() }} />
      : <EntityPickerDialog title={title} description={description} items={items} folders={folders} foldersFailed={foldersFailed} categories={props.categories} initialId={props.value ?? ''} state={state} listFooter={props.listFooter}
        query={props.query} onQueryChange={props.onQueryChange}
        createAction={props.createAction ? { ...props.createAction, onCreate: (query) => { props.createAction?.onCreate(query); close() } } : undefined}
        preview={props.preview} readOnly={readOnly} createHref={createHref} createLabel={createLabel} confirmLabel={props.confirmLabel} onSelect={props.onSelect} confirmDisabled={props.confirmDisabled}
        searchPlaceholder={props.searchPlaceholder} designNode="dJZ7Q" onCancel={close} onConfirm={(value) => { props.onChange(value); close() }} />
      : null}
  </>
}
