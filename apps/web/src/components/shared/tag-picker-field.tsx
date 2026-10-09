'use client'
import { useEffect, useRef, useState, useCallback, type Ref } from 'react'
import { ChevronRight, Plus, Tag as TagIcon } from 'lucide-react'
import { folderDisplayColor } from './folder-dot'
import { api } from '@/lib/api'
import { useTapActionAccount } from './use-tap-action-sources'
import Button from './button'
import Checkbox from './checkbox'
import SearchField from './search-field'
import { TextField } from './text-field'
import { FolderDot } from './folder-dot'
import TagPill from './tag-pill'
import FolderPickerShell from './folder-picker-shell'
import styles from './tag-picker-field.module.css'

export type TagPickerOption = { id: string; name: string; groupId?: string | null; isStarred?: boolean; lineAccountId?: string | null }
/** 案A：欄全体が押せる。窓を開いても、選ぶまで保存値は変えない。 */
export default function TagPickerField({ label = 'タグを付ける', value, onChange, options, accountId, readOnly = false, disabled = false, invalid = false, multiple = true, id: fieldId, buttonRef, describedBy }: {
  label?: string; value: string[]; onChange: (ids: string[]) => void; options?: readonly TagPickerOption[]
  accountId?: string | null; readOnly?: boolean; disabled?: boolean; invalid?: boolean; multiple?: boolean; id?: string; buttonRef?: Ref<HTMLButtonElement>; describedBy?: string
}) {
  const account = useTapActionAccount()
  const id = accountId === undefined ? account?.selectedAccountId ?? null : accountId
  const [items, setItems] = useState<TagPickerOption[]>(() => [...(options ?? [])])
  const [folders, setFolders] = useState<Array<{ id: string; name: string; color?: string | null; accountId?: string | null }>>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(options ? 'ready' : 'loading')
  const [folderFailed, setFolderFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const request = useRef(0)
  const hasProvidedOptions = options !== undefined
  const hasSelection = value.length > 0
  const createdItems = useRef<TagPickerOption[]>([])
  useEffect(() => { if (options) setItems([...options, ...createdItems.current.filter(item => !options.some(option => option.id === item.id))]) }, [options])
  useEffect(() => { request.current += 1; createdItems.current = []; if (!hasProvidedOptions) { setItems([]); setStatus('loading') } setFolders([]); setOpen(false); return () => { request.current += 1 } }, [id, hasProvidedOptions])
  const load = useCallback(async () => {
    const current = ++request.current
    setStatus('loading')
    setFolderFailed(false)
    await Promise.allSettled([
      Promise.resolve().then(() => api.tags.list({ accountId: id })).then(res => {
        if (current !== request.current) return
        if (res.success) { setItems(res.data); setStatus('ready') } else setStatus('error')
      }, () => { if (current === request.current) setStatus('error') }),
      Promise.resolve().then(() => api.tagGroups.list(id ?? undefined)).then(res => {
        if (current !== request.current) return
        if (res.success) setFolders(res.data); else setFolderFailed(true)
      }, () => { if (current === request.current) setFolderFailed(true) }),
    ])
  }, [id])
  useEffect(() => { if (hasSelection && !hasProvidedOptions) void load() }, [id, hasSelection, hasProvidedOptions, load])
  const names = value.map(key => items.find(item => item.id === key)?.name ?? '選択済みのタグ')
  const selection = <span className={styles.selection}>{value.length ? value.map((key, index) => {
    const item = items.find(tag => tag.id === key)
    const folder = folders.find(group => group.id === item?.groupId)
    return <TagPill size="xs" key={key} name={names[index]} color={folder ? folderDisplayColor(folder) : null} />
  }) : <span className={styles.placeholder}>タグを選ぶ</span>}</span>
  return <>
    {readOnly ? <div className={styles.field}>{selection}</div> : <button id={fieldId} ref={buttonRef} aria-describedby={describedBy} type="button" className={styles.field} aria-label={`${label}：${value.length ? '変える' : '選ぶ'}`} aria-haspopup="dialog" aria-invalid={invalid || undefined} disabled={disabled} onClick={() => { setOpen(true); void load() }}>
      <TagIcon size={14} aria-hidden="true" />{selection}<span className={styles.change}>{value.length ? '変える' : '選ぶ'}</span><ChevronRight size={14} aria-hidden="true" />
    </button>}
    {open ? <TagPickerDialog key={id ?? "hq"} multiple={multiple} items={items} folders={folders} folderFailed={folderFailed} status={status} initialIds={value} accountId={id} onCreated={tag => { createdItems.current.push(tag); setItems(current => [...current.filter(item => item.id !== tag.id), tag]) }} onCancel={() => setOpen(false)} onConfirm={ids => { onChange(ids); setOpen(false) }} onRetry={() => void load()} /> : null}
  </>
}
function TagPickerDialog({ multiple, items, folders, folderFailed, status, initialIds, accountId, onCreated, onConfirm, onCancel, onRetry }: {
  multiple: boolean; items: TagPickerOption[]; folders: Array<{ id: string; name: string; color?: string | null; accountId?: string | null }>
  folderFailed: boolean; status: 'loading' | 'ready' | 'error'; initialIds: string[]; accountId: string | null
  onCreated: (tag: TagPickerOption) => void; onConfirm: (ids: string[]) => void; onCancel: () => void; onRetry: () => void
}) {
  const [selected, setSelected] = useState(initialIds)
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('all')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const rows = [
    { id: 'frequent', kind: 'folder' as const, label: 'よく使う', count: items.filter(item => item.isStarred).length },
    { id: 'all', kind: 'all' as const, label: 'すべて', count: status === 'ready' ? items.length : null },
    ...folders.map(group => ({ id: group.id, kind: 'folder' as const, label: group.name, color: group.color, count: items.filter(item => item.groupId === group.id).length })),
    { id: 'none', kind: 'unfiled' as const, label: '未分類', count: status === 'ready' ? items.filter(item => !item.groupId).length : null },
  ]
  const shown = items.filter(item => (folder === 'all' || (folder === 'frequent' ? item.isStarred : folder === 'none' ? !item.groupId : item.groupId === folder)) && item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
  const create = async () => {
    if (!name.trim() || busy) return
    // 統括は店のタグを複製して配る。所属なしのタグを新しく作らない。
    const sourceIds = [...new Set(items.flatMap(item => item.lineAccountId ? [item.lineAccountId] : []))]
    const sourceAccountId = accountId ?? folders.find(group => group.id === folder)?.accountId ?? (sourceIds.length === 1 ? sourceIds[0] : null)
    if (!sourceAccountId) { setError('タグを作る店舗を決めるため、左の店舗のフォルダを選んでください。'); return }
    setBusy(true); setError('')
    try {
      const res = await api.tags.create({ name: name.trim(), groupId: ['all', 'frequent', 'none'].includes(folder) ? null : folder, lineAccountId: sourceAccountId })
      if (!mounted.current) return
      if (!res.success) { setError('タグを作れませんでした。名前とフォルダを確認してください。'); return }
      onCreated(res.data); setSelected(current => multiple ? [...new Set([...current, res.data.id])] : [res.data.id]); setCreating(false); setName('')
    } catch { if (mounted.current) setError('タグを作れませんでした。もう一度お試しください。') }
    finally { if (mounted.current) setBusy(false) }
  }
  return <FolderPickerShell busy={busy} title="タグを選ぶ" onClose={() => { if (!busy) onCancel() }} rows={rows} activeId={folder} onFolder={setFolder}
    search={<div className={styles.searchRow}><SearchField ref={inputRef} aria-label="タグ名で探す" placeholder="タグ名で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />{!creating && status === 'ready' ? <Button variant="text" onClick={() => setCreating(true)}><Plus size={14} />その場でタグを作る</Button> : null}</div>}
    sideNote={folderFailed ? <p className={styles.error}>フォルダを読み込めませんでした</p> : null}
    footer={<><span className={styles.count} aria-live="polite">{selected.length}件選んでいます</span><Button disabled={busy} onClick={onCancel}>キャンセル</Button><Button variant="primary" disabled={busy || status !== 'ready'} onClick={() => onConfirm(selected)}>選ぶ（{selected.length}件）</Button></>}
  >
    {status === 'loading' ? <p>タグを読み込んでいます。</p> : status === 'error' ? <><p role="alert" className={styles.error}>タグを読み込めませんでした。</p><Button onClick={onRetry}>もう一度読み込む</Button></> : <>
      {creating ? <div className={styles.create}><TextField aria-label="新しいタグの名前" placeholder="タグの名前" value={name} onChange={event => setName(event.target.value)} invalid={Boolean(error)} /><Button busy={busy} disabled={busy || !name.trim()} onClick={() => void create()}>作る</Button><Button disabled={busy} onClick={() => setCreating(false)}>やめる</Button></div> : null}
      <div className={styles.rows}>{selected.filter(key => !items.some(item => item.id === key)).map(key => <div key={key} className={styles.item}><Checkbox checked disabled={busy} aria-label="見つからないタグを外す" onCheckedChange={() => setSelected(current => current.filter(id => id !== key))}>見つからないタグ（選び直してください）</Checkbox></div>)}{shown.map(item => <div key={item.id} className={styles.item} data-selected={selected.includes(item.id) || undefined}>
        <Checkbox aria-label={item.name} checked={selected.includes(item.id)} disabled={busy} onCheckedChange={on => setSelected(current => on ? multiple ? [...new Set([...current, item.id])] : [item.id] : current.filter(key => key !== item.id))}><span className={styles.tagName}><FolderDot folder={folders.find(group => group.id === item.groupId) ?? null} /><span title={item.name}>{item.name}</span></span></Checkbox>
      </div>)}{!shown.length ? <p>当てはまるタグがありません。</p> : null}</div>

      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </>}
  </FolderPickerShell>
}
