"use client"

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, Zap, type LucideIcon } from 'lucide-react'
import ConfirmDialog from './confirm-dialog'
import Button from './button'
import ActionMenu, { type ActionMenuItem } from './action-menu'
import { RowActions, useReorder } from './row-actions'
import { EntityPickerDialog, EntityMultiPickerDialog, type EntityPickerItem } from './entity-picker'
import ReorderHandle, { type ReorderHandleProps } from './reorder-handle'
import styles from './action-list.module.css'

export type ActionChoice<T> = {
  id: string
  label: string
  icon?: LucideIcon
  make: () => T
  disabled?: boolean
  disabledReason?: string
  picker?: {
    title: string
    items: EntityPickerItem[]
    multiple?: boolean
    apply: (item: T, ids: string[]) => T
  }
}

/** B-169: 種類を選んでから対象を確定する。取消では空の行を追加しない。 */
export function ActionAddButton<T>({ choices, onAdd, disabled = false, id }: {
  choices: ActionChoice<T>[]
  onAdd: (item: T) => void
  disabled?: boolean
  id?: string
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pending = choices.find(choice => choice.id === pendingId) ?? null
  const confirmTarget = (ids: string[]) => {
    if (!pending?.picker) return
    onAdd(pending.picker.apply(pending.make(), ids))
    setPendingId(null)
  }
  return <>
    <Button id={id} ref={anchor} type="button" variant="secondary" disabled={disabled || choices.length === 0}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Plus size={16} aria-hidden="true" />行うことを足す
    </Button>
    <ActionMenu open={open} anchorRef={anchor} ariaLabel="行うことの種類" onClose={() => setOpen(false)}
      items={choices.map(choice => ({ id: choice.id, label: choice.label, disabled: choice.disabled, disabledReason: choice.disabledReason,
        icon: choice.icon ? <choice.icon size={16} aria-hidden="true" /> : undefined,
        onSelect: () => { if (choice.picker) setPendingId(choice.id); else onAdd(choice.make()) },
      }))} />
    {pending?.picker ? pending.picker.multiple
      ? <EntityMultiPickerDialog title={pending.picker.title} items={pending.picker.items} initialIds={[]} allowEmpty={false} onConfirm={confirmTarget} onCancel={() => setPendingId(null)} />
      : <EntityPickerDialog title={pending.picker.title} items={pending.picker.items} onConfirm={id => confirmTarget([id])} onCancel={() => setPendingId(null)} />
      : null}
  </>
}

/** つまみの寸法も行の持ち主で揃える。 */
export function ActionDragHandle(props: Omit<ReorderHandleProps, 'look' | 'className'>) {
  return <ReorderHandle {...props} look="bare" className={styles.grip} />
}

/** 行の形の持ち主。本文・失敗時・権限と保存の処理は呼び出し側から渡す。 */
export function ActionRow({ title, kind, icon: Icon = Zap, number, open, readOnly = false, onToggle, handle, rowProps,
  menuItems = [], onRemove, children, extra, hint }: {
  title: string
  kind?: string
  icon?: LucideIcon
  number: number
  open?: boolean
  readOnly?: boolean
  onToggle?: () => void
  handle?: ReactNode
  rowProps?: React.HTMLAttributes<HTMLDivElement>
  menuItems?: ActionMenuItem[]
  onRemove?: () => void
  children?: ReactNode
  extra?: ReactNode
  hint?: ReactNode
}) {
  const [removing, setRemoving] = useState(false)
  return <div className={styles.item} {...rowProps} data-action-row data-event-action-row>
    <div className={styles.row}>
      {readOnly ? null : handle}
      <span className={styles.icon}><Icon size={16} aria-hidden="true" /></span>
      {kind ? <span className={styles.kind} title={kind}>{kind}</span> : null}
      {readOnly || !onToggle ? <span className={styles.title} title={title}>{title}</span>
        : <button type="button" className={styles.titleButton} title={title} aria-expanded={Boolean(open)} onClick={onToggle}>{title}</button>}
      {extra ? <div className={styles.extra}>{extra}</div> : null}
      {readOnly ? null : <RowActions menuAppearance="box" menuSize="row" subjectName={`${number}つ目の行うこと`} menuItems={[
        ...(onToggle ? [{ id: 'edit', label: open ? '設定を閉じる' : '設定を変える', onSelect: onToggle }] : []), ...menuItems,
      ]} destructiveItem={onRemove ? { id: 'remove', label: '削除する', onSelect: () => setRemoving(true) } : undefined} />}
    </div>
    {hint}
    <ConfirmDialog open={removing} title="行うことを削除しますか？" description={title} confirmLabel="削除する" onCancel={() => setRemoving(false)} onConfirm={() => { setRemoving(false); onRemove?.() }} />
    {open && !readOnly ? <div className={styles.editor}>{children}</div> : null}
  </div>
}

/** 保存形式を変えず、追加・その場の編集・ドラッグ／キー／メニューの並べ替えを共通化。 */
export default function ActionList<T>({ value, onChange, choices, idOf, titleOf, kindOf, iconOf, renderEditor, renderExtra, renderHint, readOnly = false, addId, reorderable = true, numberOf, editingId, minItems = 0, duplicateOf }: {
  value: T[]
  onChange: (next: T[]) => void
  choices: ActionChoice<T>[]
  idOf: (item: T, index: number) => string
  titleOf: (item: T) => string
  kindOf?: (item: T) => string
  iconOf?: (item: T) => LucideIcon | undefined
  renderEditor: (item: T, update: (next: T) => void, index: number) => ReactNode
  renderExtra?: (item: T, index: number) => ReactNode
  renderHint?: (item: T, index: number) => ReactNode
  readOnly?: boolean
  addId?: string
  reorderable?: boolean
  numberOf?: (item: T, index: number) => number
  /** 保存時の入力エラーなど、親から開く行。 */
  editingId?: string | null
  minItems?: number
  duplicateOf?: (item: T) => T
}) {
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => { if (editingId !== undefined) setEditing(editingId) }, [editingId])
  const slots = value.map((item, index) => ({ item, id: idOf(item, index) }))
  const reorder = useReorder({ items: slots, idOf: slot => slot.id,
    onReorder: ({ ids }) => { setEditing(null); onChange(ids.map(id => slots.find(slot => slot.id === id)!.item)) } })
  return <div className={styles.list} data-action-list data-shared-part="event-actions" data-event-actions>
    {value.length === 0 ? <p className={styles.empty}>行うことはまだありません。</p> : null}
    {reorder.shown.map(({ item, id }, index) => <ActionRow key={id} number={numberOf?.(item, index) ?? index + 1} title={titleOf(item)} kind={kindOf?.(item)} icon={iconOf?.(item)}
      readOnly={readOnly} open={editing === id} onToggle={() => setEditing(editing === id ? null : id)}
      rowProps={reorderable ? reorder.rowProps(id) : undefined} handle={reorderable ? <ActionDragHandle label={`${index + 1}つ目の行うこと`} ariaLabel={`${index + 1}つ目の行うことを並べ替える`} {...reorder.handle(id)} {...reorder.handleProps(id)} /> : null}
      menuItems={[...(duplicateOf ? [{ id: 'duplicate', label: '複製する', onSelect: () => { const copy = duplicateOf(item); onChange([...value.slice(0, index + 1), copy, ...value.slice(index + 1)]); setEditing(idOf(copy, index + 1)) } }] : []), ...(reorderable ? reorder.menuItems(id) : [])]} onRemove={value.length > minItems ? () => { setEditing(null); onChange(slots.filter(slot => slot.id !== id).map(slot => slot.item)) } : undefined} extra={renderExtra?.(item, index)} hint={renderHint?.(item, index)}>
      {renderEditor(item, next => onChange(slots.map(slot => slot.id === id ? next : slot.item)), index)}
    </ActionRow>)}
    {readOnly || choices.length === 0 ? null : <div className={styles.add}><ActionAddButton id={addId} choices={choices} onAdd={item => { setEditing(idOf(item, value.length)); onChange([...value, item]) }} /></div>}
  </div>
}
