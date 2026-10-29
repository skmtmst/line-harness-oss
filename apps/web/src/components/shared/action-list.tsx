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
import NumberedActionRow from './numbered-action-row'

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
    /** 種類ごとのフォルダ・作成・見本も、既存の選ぶ窓へ渡す。 */
    render?: (props: { onConfirm: (ids: string[]) => void; onCancel: () => void }) => ReactNode
    apply: (item: T, ids: string[]) => T
  }
}

/** : 種類を選んでから対象を確定する。取消では空の行を追加しない。 */
export function ActionAddButton<T>({ choices, onAdd, disabled = false, lockedReason, id, label = '行うことを足す', direct = false }: {
  choices: ActionChoice<T>[]
  onAdd: (item: T) => void
  disabled?: boolean
  lockedReason?: string
  id?: string
  label?: string
  direct?: boolean
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const blocked = disabled || Boolean(lockedReason)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  useEffect(() => { if (blocked) { setOpen(false); setPendingId(null) } }, [blocked])
  const add = (item: T) => { if (!blockedRef.current) onAdd(item) }
  const pending = choices.find(choice => choice.id === pendingId) ?? null
  const confirmTarget = (ids: string[]) => {
    if (blockedRef.current || !pending?.picker) return
    add(pending.picker.apply(pending.make(), ids))
    setPendingId(null)
  }
  return <>
    <Button id={id} ref={anchor} type="button" variant={direct ? 'text' : 'secondary'} lockedReason={lockedReason} disabled={disabled || choices.length === 0 || (direct && choices[0]?.disabled)}
      aria-haspopup={direct ? 'dialog' : 'menu'} aria-expanded={direct ? Boolean(pendingId) : open} onClick={() => { if (blockedRef.current) return; if (direct) { const choice = choices[0]; if (choice?.picker) setPendingId(choice.id); else if (choice) add(choice.make()) } else setOpen(!open) }}>
      <Plus size={16} aria-hidden="true" />{label}
    </Button>
    <ActionMenu open={open && !blocked} anchorRef={anchor} align="start" ariaLabel="行うことの種類" onClose={() => setOpen(false)}
      items={choices.map(choice => ({ id: choice.id, label: choice.label, disabled: choice.disabled, disabledReason: choice.disabledReason,
        icon: choice.icon ? <choice.icon size={16} aria-hidden="true" /> : undefined,
        onSelect: () => { if (blockedRef.current) return; if (choice.picker) setPendingId(choice.id); else add(choice.make()) },
      }))} />
    {!blocked && pending?.picker ? pending.picker.render ? pending.picker.render({ onConfirm: confirmTarget, onCancel: () => setPendingId(null) }) : pending.picker.multiple
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
export function ActionRow({ title, kind, icon: Icon = Zap, number, open, readOnly = false, disabled = false, lockedReason, onToggle, handle, rowProps,
  menuItems = [], onRemove, children, extra, hint }: {
  title: string
  kind?: string
  icon?: LucideIcon
  number: number
  open?: boolean
  readOnly?: boolean
  disabled?: boolean
  lockedReason?: string
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
  const blocked = disabled || Boolean(lockedReason)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  useEffect(() => { if (blocked) setRemoving(false) }, [blocked])
  return <div className={styles.item} {...rowProps} data-action-row data-event-action-row>
    <div className={styles.row}>
      {readOnly ? null : handle}
      <span className={styles.icon}><Icon size={16} aria-hidden="true" /></span>
      {kind ? <span className={styles.kind} title={kind}>{kind}</span> : null}
      <div className={styles.details}>
        {readOnly || !onToggle ? <span className={styles.title} data-action-name title={title}>{title}</span>
          : <button type="button" className={styles.titleButton} data-action-name title={title} aria-expanded={Boolean(open)} onClick={onToggle}>{title}</button>}
        {extra ? <div className={styles.extra} data-action-value title={typeof extra === 'string' ? extra : undefined}>{extra}</div> : null}
      </div>
      {readOnly ? null : <RowActions menuAppearance="box" menuSize="row" subjectName={`${number}つ目の行うこと`} menuItems={[
        ...(onToggle ? [{ id: 'edit', label: open ? '設定を閉じる' : blocked ? '設定を見る' : '設定を変える', onSelect: onToggle }] : []), ...menuItems,
      ]} destructiveItem={onRemove ? { id: 'remove', label: '削除する', disabled, lockedReason, onSelect: () => { if (!blockedRef.current) setRemoving(true) } } : undefined} />}
    </div>
    {hint}
    <ConfirmDialog open={removing && !blocked} title="行うことを削除しますか？" description={title} confirmLabel="削除する" onCancel={() => setRemoving(false)} onConfirm={() => { setRemoving(false); if (!blockedRef.current) onRemove?.() }} />
    {open && !readOnly ? <div className={styles.editor}>{children}</div> : null}
  </div>
}

/** 保存形式を変えず、追加・その場の編集・ドラッグ／キー／メニューの並べ替えを共通化。 */
export default function ActionList<T>({ value, onChange, choices, idOf, titleOf, kindOf, iconOf, renderEditor, renderExtra, renderHint, readOnly = false, disabled = false, lockedReason, addId, reorderable = true, numberOf, editingId, minItems = 0, duplicateOf, quickAddChoiceId, appearance = 'inline', addActions }: {
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
  disabled?: boolean
  lockedReason?: string
  addId?: string
  reorderable?: boolean
  numberOf?: (item: T, index: number) => number
  /** 保存時の入力エラーなど、親から開く行。 */
  editingId?: string | null
  minItems?: number
  duplicateOf?: (item: T) => T
  quickAddChoiceId?: string
  appearance?: 'inline' | 'numbered'
  addActions?: ReactNode
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const blocked = disabled || Boolean(lockedReason)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const change = (next: T[]) => { if (!blockedRef.current) onChange(next) }
  const editor = (item: T, update: (next: T) => void, index: number) => {
    const content = renderEditor(item, next => { if (!blockedRef.current) update(next) }, index)
    return blocked ? <fieldset className={styles.disabledFields} disabled aria-label="設定内容">{content}</fieldset> : content
  }
  useEffect(() => { if (blocked) setEditing(null) }, [blocked])
  useEffect(() => { if (editingId !== undefined) setEditing(editingId) }, [editingId])
  const slots = value.map((item, index) => ({ item, id: idOf(item, index) }))
  const reorder = useReorder({ items: slots, idOf: slot => slot.id,
    onReorder: ({ ids }) => { if (blockedRef.current) return; setEditing(null); change(ids.map(id => slots.find(slot => slot.id === id)!.item)) } })
  /* 種類の列は全行で同じ幅。いちばん長い種類の言葉が切れない幅まで広げる（既定の幅より狭くはしない・最大 12 字）。 */
  const kindChars = Math.min(12, Math.max(0, ...value.map((item) => kindOf?.(item)?.length ?? 0)))
  return <div className={styles.list} data-action-list data-shared-part="event-actions" data-event-actions style={kindChars ? { ['--action-kind-fit' as string]: `${kindChars}em` } : undefined}>
    {value.length === 0 ? <p className={styles.empty}>行うことはまだありません。</p> : null}
    {reorder.shown.map(({ item, id }, index) => appearance === 'numbered' ? <NumberedActionRow key={id}
      number={numberOf?.(item, index) ?? index + 1} title={kindOf?.(item) ?? titleOf(item)} summary={titleOf(item)}
      readOnly={readOnly} disabled={disabled} lockedReason={lockedReason} open={editing === id} onToggle={() => setEditing(editing === id ? null : id)}
      onMoveUp={reorderable && index > 0 ? () => { setEditing(null); change([...value.slice(0, index - 1), item, value[index - 1], ...value.slice(index + 1)]) } : undefined}
      onMoveDown={reorderable && index < value.length - 1 ? () => { setEditing(null); change([...value.slice(0, index), value[index + 1], item, ...value.slice(index + 2)]) } : undefined}
      reorderable={reorderable} onRemove={value.length > minItems ? () => { setEditing(null); change(value.filter((_, slot) => slot !== index)) } : undefined}>
      {renderHint?.(item, index)}
      {editor(item, next => change(value.map((entry, slot) => slot === index ? next : entry)), index)}
    </NumberedActionRow> : <ActionRow key={id} number={numberOf?.(item, index) ?? index + 1} title={titleOf(item)} kind={kindOf?.(item)} icon={iconOf?.(item)}
      readOnly={readOnly} disabled={disabled} lockedReason={lockedReason} open={editing === id} onToggle={() => setEditing(editing === id ? null : id)}
      rowProps={reorderable && !blocked ? reorder.rowProps(id) : undefined} handle={reorderable ? <ActionDragHandle label={`${index + 1}つ目の行うこと`} ariaLabel={`${index + 1}つ目の行うことを並べ替える`} {...reorder.handle(id)} {...reorder.handleProps(id)} locked={blocked} lockedReason={lockedReason} /> : null}
      menuItems={[...(duplicateOf ? [{ id: 'duplicate', label: '複製する', onSelect: () => { const copy = duplicateOf(item); change([...value.slice(0, index + 1), copy, ...value.slice(index + 1)]); setEditing(idOf(copy, index + 1)) } }] : []), ...(reorderable ? reorder.menuItems(id) : [])].map(item => ({ ...item, disabled: disabled || item.disabled, lockedReason: lockedReason ?? item.lockedReason }))} onRemove={value.length > minItems ? () => { setEditing(null); change(slots.filter(slot => slot.id !== id).map(slot => slot.item)) } : undefined} extra={renderExtra?.(item, index)} hint={renderHint?.(item, index)}>
      {editor(item, next => change(slots.map(slot => slot.id === id ? next : slot.item)), index)}
    </ActionRow>)}
    {readOnly ? null : addActions ?? (choices.length === 0 ? null : <div className={styles.add}><ActionAddButton disabled={disabled} lockedReason={lockedReason} id={addId} choices={choices} onAdd={item => { setEditing(idOf(item, value.length)); change([...value, item]) }} />{quickAddChoiceId && choices.some(choice => choice.id === quickAddChoiceId) ? <ActionAddButton disabled={disabled} lockedReason={lockedReason} direct label="共通アクションから選ぶ" choices={choices.filter(choice => choice.id === quickAddChoiceId)} onAdd={item => { setEditing(idOf(item, value.length)); change([...value, item]) }} /> : null}</div>)}
  </div>
}
