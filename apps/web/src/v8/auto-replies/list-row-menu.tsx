'use client'

import { Activity, Copy, Folder, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import type { ContextMenuItem } from '@/components/shared/context-menu'
import { VIEW_ONLY_MENU_IDS, type AutoReply } from './list-model'

type RowMenuActions = {
  canEdit: boolean
  lockedReason?: string
  canRun: () => boolean
  edit: () => void
  runs: () => void
  duplicate: () => void
  stop: () => void
  resume: () => void
  move: () => void
  remove: () => void
}

/** 一覧と右クリックの変更操作は同じ理由と、実行時の判定を持つ。 */
export function autoReplyRowMenu(row: AutoReply, actions: RowMenuActions): ActionMenuItem[] {
  const items: ActionMenuItem[] = [
    { id: 'edit', label: '編集する', icon: <Pencil size={16} aria-hidden="true" />, onSelect: actions.edit },
    { id: 'runs', label: '実行結果を見る', icon: <Activity size={16} aria-hidden="true" />, onSelect: actions.runs },
    { id: 'duplicate', label: '複製する', icon: <Copy size={16} aria-hidden="true" />, onSelect: actions.duplicate },
  ]
  if (row.isActive || row.lifecycleStatus !== 'draft') {
    items.push(row.isActive
      ? { id: 'stop', label: '止める', icon: <Pause size={16} aria-hidden="true" />, dividerBefore: true, onSelect: actions.stop }
      : { id: 'resume', label: '再開する', icon: <Play size={16} aria-hidden="true" />, dividerBefore: true, onSelect: actions.resume })
  }
  items.push(
    { id: 'move', label: 'フォルダへ移す', icon: <Folder size={16} aria-hidden="true" />, onSelect: actions.move },
    { id: 'delete', label: '削除する', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', dividerBefore: true, onSelect: actions.remove },
  )
  return items.map(item => VIEW_ONLY_MENU_IDS.has(item.id) ? item : {
    ...item,
    disabled: !actions.canEdit && !actions.lockedReason,
    lockedReason: actions.lockedReason,
    onSelect: () => { if (actions.canRun()) item.onSelect?.() },
  })
}

export function autoReplyContextMenu(items: ActionMenuItem[]): ContextMenuItem[] {
  return items.map(item => ({
    id: item.id, label: item.label, danger: item.tone === 'danger', disabled: item.disabled,
    disabledReason: item.disabledReason, lockedReason: item.lockedReason,
    onSelect: () => item.onSelect?.(),
  }))
}
