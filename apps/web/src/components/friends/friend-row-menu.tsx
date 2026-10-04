'use client'

import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import type { FriendAction } from './single-friend-actions'

export default function FriendRowMenu({ friendId, friendName, attention, canEdit = false, allowedActions, onAction, onToggleAttention }: {
  friendId: string
  friendName: string
  attention: boolean
  canEdit?: boolean
  allowedActions?: FriendAction[]
  onAction?: (action: FriendAction) => void
  onToggleAttention?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const allowed = (action: FriendAction) => allowedActions ? allowedActions.includes(action) : canEdit
  const edit = (id: FriendAction, label: string, dividerBefore = false): ActionMenuItem => ({
    id, label, dividerBefore, disabled: !allowed(id) || !onAction,
    disabledReason: allowed(id) ? undefined : '閲覧のみでは変更できません',
    onSelect: () => onAction?.(id),
  })
  const items: ActionMenuItem[] = [
    { id: 'talk', label: 'トークを開く', onSelect: () => router.push(`/chats?friend=${friendId}`) },
    { id: 'detail', label: '友だちの詳細を見る', onSelect: () => router.push(`/friends/detail?id=${friendId}`) },
    edit('status', '対応状況を変える'),
    edit('operator', '担当者を変える'),
    edit('tag', 'タグを付ける・外す'),
    { id: 'attention', label: attention ? '注目から外す' : '注目にする', disabled: !canEdit, disabledReason: '閲覧のみでは変更できません', onSelect: () => onToggleAttention?.() },
    edit('template', 'テンプレートを送る', true),
    edit('scenario', 'シナリオを開始'),
    edit('field', '友だち情報を書き換える'),
    edit('reminder', 'リマインダを開始'),
  ]
  return <span onClick={(event) => event.stopPropagation()}>
    <Button ref={anchorRef} aria-label={`${friendName}のその他操作`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="h-8 w-8 p-0"><MoreHorizontal size={16} /></Button>
    <ActionMenu open={open} anchorRef={anchorRef} items={items} ariaLabel={`${friendName}の操作`} onClose={() => setOpen(false)} />
  </span>
}
