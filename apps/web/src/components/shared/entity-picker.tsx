'use client'

/*
 * 作ってあるもの・配るアカウントを選ぶ窓（オーナー採用 B-131・B-133・Pen dJZ7Q／2026-10-09）。
 *
 * - 1つ選ぶ窓（EntityPickerDialog）：統括の一括配信①「テンプレートを選ぶ」（EpTBB）の形が正
 *   （10-09 オーナー）。頭に題・説明・探す欄・×、左にフォルダの列、真ん中に種類の札と一覧、
 *   右に中身の見本（スマホ。出せる種類だけ。出せないときは真ん中を広く）。
 *   行を押しても仮に選ぶだけで、［選ぶ］を押したときだけ呼ぶ側へ返す。
 * - まとめて選ぶ窓（EntityMultiPickerDialog）：チェックで選ぶ。フォルダの横のチェックで
 *   フォルダごと選べる（一部だけのときは「－」）。下に「〇件選んでいます」と［選んだものだけ見る］。
 * - 窓の中に［新しく作る］は置かない。作る画面へは下の文字リンク。
 * - 閲覧のみでも窓は開いて中身を見られるが、［選ぶ］は出さない。
 * - 画面の欄（EntityPickerField）は「選んだもの（印・名前・補足）＋［選ぶ］／［変える］」の1行。
 */
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
function folderNameOf(id: string | null | undefined, folders: EntityPickerFolder[]) {
  return id ? folders.find((folder) => folder.id === id)?.name ?? '—' : '未分類'
}
function inFolder(item: EntityPickerItem, folder: string) {
  return !folder || (folder === UNFILED ? !item.folderId : item.folderId === folder)
}
function matches(item: EntityPickerItem, query: string) {
  const q = query.trim().toLocaleLowerCase()
  return !q || item.name.toLocaleLowerCase().includes(q) || Boolean(item.keywords?.toLocaleLowerCase().includes(q))
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
  initialId?: string
  /** 一覧の代わりに出す状態（読み込み中・失敗）。 */
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
  onSelect?: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
}

/** 1つ選ぶ窓。候補を押す間は仮の選択。［選ぶ］だけが呼ぶ側の値を変える。 */
export function EntityPickerDialog({
  title, description, confirmLabel = '選ぶ', items, folders = [], foldersFailed = false, categories = [], initialId = '',
  state, preview, error, busy = false, confirmDisabled = false, readOnly = false, createHref, createLabel,
  searchPlaceholder = '名前で探す', designNode = 'EpTBB', onSelect, onConfirm, onCancel,
}: SingleProps) {
  const id = useId()
  const [selected, setSelected] = useState(initialId)
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState(ALL)
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(20)
  const [panelRef, narrow] = useNarrow(1100)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLimit(20) }, [query, folder, category])

  const hasFolders = folders.length > 0 || items.some((item) => item.folderId !== undefined)
  const hasCategories = categories.length > 0
  const hasPreview = preview !== undefined
  const folderItems = items.filter((item) => inFolder(item, folder))
  const rows = folderItems.filter((item) => (!category || item.category === category) && matches(item, query))
  const picked = items.find((item) => item.id === selected) ?? null
  const listState = Boolean(state)
  const folderRows = pickerFolderRows(items, folders, listState)
  const folderOptions = folderRows.map((row) => ({ value: row.id, label: `${row.label}（${row.count ?? '—'}）` }))
  const choose = (itemId: string) => { setSelected(itemId); onSelect?.(itemId) }
  const previewNode = typeof preview === 'function' ? preview(picked) : preview
  const pickedText = picked ? `選んだもの：${picked.name}${picked.categoryLabel ? `（${picked.categoryLabel}）` : ''}` : '選んだもの：まだ選んでいません'

  return <SelectionDialog title={title} description={description} busy={busy} error={error} designNode={designNode} onCancel={onCancel} initialFocusRef={searchRef}
    search={<SearchField ref={searchRef} aria-label={`${title}：${searchPlaceholder}`} placeholder={searchPlaceholder} value={query} onChange={setQuery} onClear={() => setQuery('')} />}
    footer={<>
      <CreateLink href={createHref} label={createLabel} />
      <span className={shell.selection} title={picked?.name}>{pickedText}</span>
      <Button disabled={busy} onClick={onCancel}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
      {readOnly ? null : <Button variant="primary" busy={busy} disabled={busy || !picked || picked.disabled || listState || confirmDisabled} onClick={() => onConfirm(selected)}><Check size={16} aria-hidden />{confirmLabel}</Button>}
    </>}
  >
    <div ref={panelRef} className={shell.body}>
      {hasFolders && !narrow ? <div className={shell.folders}>
        <FolderPanel readOnly disabled={busy || listState} rows={folderRows} activeId={folder} onSelect={setFolder} />
      </div> : null}
      <section className={shell.list} aria-label="候補の一覧">
        {hasFolders && narrow ? <Select disabled={busy || listState} aria-label="候補のフォルダ" value={folder} onChange={setFolder} options={folderOptions} /> : null}
        {foldersFailed ? <p className={styles.note}>フォルダを読み込めませんでした。すべての候補から選べます。</p> : null}
        {hasCategories ? <div className={shell.categories} aria-label="候補の絞り込み">
          {[{ id: '', label: 'すべて' }, ...categories].map((c) => <FilterChip key={c.id} selected={category === c.id} disabled={busy || listState} count={listState ? undefined : folderItems.filter((item) => !c.id || item.category === c.id).length} onChange={() => setCategory(c.id)}>{c.label}</FilterChip>)}
        </div> : null}
        <div className={shell.rows} onScroll={(event) => {
          const target = event.currentTarget
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 80) setLimit((value) => Math.min(value + 20, rows.length))
        }}>
          {state || (rows.length ? rows.slice(0, limit).map((item) => <div key={item.id} className={shell.row} data-selected={selected === item.id || undefined}>
            <Radio fill aria-label={item.name} name={`${id}-selection`} value={item.id} checked={selected === item.id} onChange={() => choose(item.id)} disabled={busy || item.disabled}>
              <span className={shell.rowContent}>
                {hasCategories ? <span className={shell.categoryCell}>{item.categoryLabel ? <StatusBadge tone={item.tone} dot={false} size="compact">{item.categoryLabel}</StatusBadge> : null}</span> : null}
                <span className={shell.itemName}><strong>{hasFolders ? <FolderDot folder={folderOf(item, folders)} /> : null}<span className={shell.nameText} title={item.name}>{item.name}</span></strong></span>
                {hasFolders ? <small className={shell.folderLabel} title={folderNameOf(item.folderId, folders)}>{folderNameOf(item.folderId, folders)}</small> : null}
                {item.meta ? <small className={shell.date} title={item.meta}>{item.meta}</small> : null}
              </span>
            </Radio>
          </div>) : <p className={shell.empty}>当てはまる候補がありません。</p>)}
        </div>
        {!listState ? <div className={shell.more}><span>{`${rows.length}件中 ${rows.length ? 1 : 0}〜${Math.min(limit, rows.length)}件`}</span>{rows.length > limit ? <Button size="compact" onClick={() => setLimit((value) => value + 20)}>続きを読み込む</Button> : null}</div> : null}
      </section>
      {hasPreview && !narrow ? <aside className={shell.preview} aria-label="選んだ候補の見え方">{previewNode}</aside> : null}
    </div>
    {hasPreview && narrow ? <details className={shell.compactPreview}><summary>選んだ候補の LINE での見え方</summary>{previewNode}</details> : null}
  </SelectionDialog>
}

/** フォルダの列の行（すべて・各フォルダ・未分類）。件数は候補の数。 */
export function pickerFolderRows(items: EntityPickerItem[], folders: EntityPickerFolder[], hideCounts = false, leading?: (ids: string[], label: string) => ReactNode): FolderPanelRow[] {
  const count = (folder: string) => (hideCounts ? null : items.filter((item) => inFolder(item, folder)).length)
  const ids = (folder: string) => items.filter((item) => inFolder(item, folder) && !item.disabled).map((item) => item.id)
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
}

/**
 * まとめて選ぶ中身（フォルダの列＋一覧）。窓の中にも、ほかの窓の中にも埋め込める。
 * フォルダの横のチェックは、そのフォルダの選べる候補をまとめて付け外しする。
 */
export function EntityMultiSelect({ items, folders = [], foldersFailed = false, selected, onChange, query, onlySelected = false, readOnly = false, busy = false, state, rowExtra, searchSlot, listLabel = '候補の一覧', folder: controlledFolder, onFolder, folderHeading, initialFolder }: MultiBodyProps) {
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
  return <div ref={panelRef} className={shell.body}>
    {hasFolders && !narrow ? <div className={shell.folders}>
      <FolderPanel readOnly heading={folderHeading} disabled={busy || Boolean(state)} rows={folderRows} activeId={folder} onSelect={setFolder} />
    </div> : null}
    <section className={`${shell.list} ${styles.multiList}`} aria-label={listLabel}>
      {searchSlot}
      {hasFolders && narrow ? <Select disabled={busy || Boolean(state)} aria-label="候補のフォルダ" value={folder} onChange={setFolder} options={folderRows.map((row) => ({ value: row.id, label: `${row.label}（${row.count ?? '—'}）` }))} /> : null}
      {foldersFailed ? <p className={styles.note}>フォルダを読み込めませんでした。すべての候補から選べます。</p> : null}
      <div className={styles.multiRows}>
        {state || (rows.length ? rows.map((item) => {
          const checked = set.has(item.id)
          const inputId = `${id}-${item.id}`
          return <div key={item.id} className={styles.multiRow} data-selected={checked || undefined} data-disabled={item.disabled || undefined}>
            <Checkbox id={inputId} aria-label={item.name} checked={checked} disabled={readOnly || busy || (item.disabled && !checked)} onCheckedChange={(on) => toggleMany([item.id], on)} />
            <label className={styles.multiName} htmlFor={inputId} title={item.name}>
              {hasFolders ? <FolderDot folder={folderOf(item, folders)} /> : null}
              <span className={styles.multiNameText}>{item.name}</span>
            </label>
            {rowExtra ? <span className={styles.multiExtra}>{rowExtra(item)}</span> : null}
            {item.meta ? <small className={styles.multiMeta} title={item.meta}>{item.meta}</small> : null}
          </div>
        }) : <p className={shell.empty}>{onlySelected ? 'まだ何も選んでいません。' : '当てはまる候補がありません。'}</p>)}
      </div>
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
  /** 数の単位（「アカウント」「件」）。 */
  unit?: string
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
export function EntityMultiPickerDialog({ title, description, items, folders, foldersFailed, initialIds, unit = '件', state, error, busy = false, readOnly = false, createHref, createLabel, searchPlaceholder = '名前で探す', allowEmpty = true, rowExtra, initialFolder, onConfirm, onCancel }: MultiProps) {
  const [selected, setSelected] = useState(initialIds)
  const [query, setQuery] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sep = unit === '件' ? '' : ' '
  const countText = `${selected.length}${sep}${unit}`
  return <SelectionDialog title={title} description={description} size="picker-narrow" designNode="dJZ7Q" busy={busy} error={error} onCancel={onCancel} initialFocusRef={searchRef}
    search={<SearchField ref={searchRef} aria-label={`${title}：${searchPlaceholder}`} placeholder={searchPlaceholder} value={query} onChange={setQuery} onClear={() => setQuery('')} />}
    footer={<>
      <CreateLink href={createHref} label={createLabel} />
      <span className={`${shell.selection} ${styles.multiCount}`} aria-live="polite">
        {`${countText}を選んでいます・`}
        <button type="button" className={styles.textButton} aria-pressed={onlySelected} onClick={() => setOnlySelected((value) => !value)}>{onlySelected ? 'すべて見る' : '選んだものだけ見る'}</button>
      </span>
      <Button disabled={busy} onClick={onCancel}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
      {readOnly ? null : <Button variant="primary" busy={busy} disabled={busy || Boolean(state) || (!allowEmpty && selected.length === 0)} onClick={() => onConfirm(selected)}>{`この${sep || ' '}${countText}にする`}</Button>}
    </>}
  >
    <EntityMultiSelect items={items} folders={folders} foldersFailed={foldersFailed} selected={selected} onChange={setSelected} query={query} onlySelected={onlySelected} readOnly={readOnly} busy={busy} state={state} rowExtra={rowExtra} initialFolder={initialFolder} />
  </SelectionDialog>
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
export function EntityPickerSummary({ label, noun, icon: Icon, name, meta, placeholder, disabled = false, readOnly = false, invalid = false, id, buttonRef, describedBy, onOpen, onClear }: {
  label: string; noun: string; icon?: LucideIcon
  /** 選んだものの名前。空なら「（〇〇を選んでください）」。 */
  name?: string; meta?: string; placeholder?: string
  disabled?: boolean; readOnly?: boolean; invalid?: boolean; id?: string
  buttonRef?: Ref<HTMLButtonElement>
  /** 欄の下の誤り・説明の id。［選ぶ］ボタンの読み上げにつなぐ。 */
  describedBy?: string
  onOpen: () => void
  /** 渡すと「外す」を出す。 */
  onClear?: () => void
}) {
  const empty = !name
  const actionLabel = readOnly ? '見る' : empty ? '選ぶ' : '変える'
  return <div className={styles.field} data-empty={empty || undefined} data-invalid={invalid || undefined} data-disabled={disabled || undefined} id={id}>
    {Icon ? <Icon className={styles.fieldIcon} size={14} aria-hidden="true" /> : null}
    <span className={styles.fieldValue}>
      {empty ? <span className={styles.fieldPlaceholder}>{placeholder ?? `（${noun}を選んでください）`}</span> : <>
        <strong className={styles.fieldName} title={name}>{name}</strong>
        {meta ? <small className={styles.fieldMeta} title={meta}>{meta}</small> : null}
      </>}
    </span>
    {onClear && !empty && !readOnly ? <Button size="compact" variant="text" disabled={disabled} aria-label={`${label}を外す`} onClick={onClear}>外す</Button> : null}
    {readOnly && empty ? null : <Button ref={buttonRef} size="compact" disabled={disabled} aria-label={`${label}：${actionLabel}`} aria-haspopup="dialog" aria-invalid={invalid || undefined} aria-describedby={describedBy} onClick={onOpen}>{actionLabel}</Button>}
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
  const [open, setOpen] = useState(false)
  const title = props.title ?? `${noun}を選ぶ`
  const picked = describePicked(items, folders, props.value, props.multiple ? props.unit : undefined, props.multiple ? props.summarize : undefined)
  const close = () => setOpen(false)
  return <>
    <EntityPickerSummary label={label} noun={noun} icon={icon} name={picked.name} meta={picked.meta} placeholder={placeholder} disabled={disabled} readOnly={readOnly}
      invalid={invalid || picked.missing} id={id} buttonRef={buttonRef} describedBy={describedBy} onOpen={() => { onOpen?.(); setOpen(true) }}
      onClear={!props.multiple && props.clearable ? () => props.onChange('') : undefined} />
    {open ? props.multiple
      ? <EntityMultiPickerDialog title={title} description={description} items={items} folders={folders} foldersFailed={foldersFailed} initialIds={props.value} unit={props.unit} state={state} readOnly={readOnly}
        createHref={createHref} createLabel={createLabel} allowEmpty={props.allowEmpty} rowExtra={props.rowExtra} searchPlaceholder={props.searchPlaceholder}
        onCancel={close} onConfirm={(ids) => { props.onChange(ids); close() }} />
      : <EntityPickerDialog title={title} description={description} items={items} folders={folders} foldersFailed={foldersFailed} categories={props.categories} initialId={props.value ?? ''} state={state}
        preview={props.preview} readOnly={readOnly} createHref={createHref} createLabel={createLabel} confirmLabel={props.confirmLabel} onSelect={props.onSelect} confirmDisabled={props.confirmDisabled}
        searchPlaceholder={props.searchPlaceholder} designNode="dJZ7Q" onCancel={close} onConfirm={(value) => { props.onChange(value); close() }} />
      : null}
  </>
}
