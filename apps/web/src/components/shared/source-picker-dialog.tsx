'use client'

import type { ReactNode, Ref } from 'react'
import Button from './button'
import StatusBadge, { type StatusBadgeTone } from './status-badge'
import { EntityPickerDialog } from './entity-picker'
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

/**
 * EpTBB：候補を選ぶ間は仮選択。使う操作だけが作成中の内容を変える。
 * 中身は共通の EntityPickerDialog（作ってあるものを選ぶ窓）。ここは一括配信①の呼び方を保つ。
 */
export default function SourcePickerDialog({ items, preview, ...rest }: {
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
  return <EntityPickerDialog {...rest} preview={preview} items={items.map((item) => ({ ...item, meta: item.updatedLabel }))} />
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
