'use client'

/* 契約試験が renderToStaticMarkup で描くので、明示的に React を読む。 */
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Circle, Star } from 'lucide-react'
import type { FriendListItem } from '@/lib/api'
import type { FriendListColumn } from './friend-list-table'

interface Props {
  friend: FriendListItem
  selected?: boolean
  onToggleSelect?: () => void
  onToggleAttention?: () => void
  visibleColumns: Set<FriendListColumn>
  gridTemplateColumns: string
}

function statusView(status: FriendListItem['chatStatus']) {
  if (status === 'unread') return { label: '未対応', className: 'bg-status-danger-soft text-danger' }
  if (status === 'in_progress' || status === 'on_hold') return { label: '対応中', className: 'bg-status-warn-soft text-status-warn-deep' }
  return { label: '対応済み', className: 'bg-accent-soft text-accent-hover' }
}

export default function FriendListRow({
  friend,
  selected,
  onToggleSelect,
  onToggleAttention,
  visibleColumns,
  gridTemplateColumns,
}: Props) {
  const router = useRouter()
  const status = statusView(friend.chatStatus)
  const latest = friend.latestIncomingMessage
  const lastContact = latest?.createdAt ?? friend.latestOutgoingAt ?? friend.createdAt
  const attention = String(friend.metadata?.__attention ?? '') === '1'
  const avatarColor = avatarTone(friend.displayName)

  const openChat = () => router.push(`/chats?friend=${friend.id}`)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openChat}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openChat()
        }
      }}
      className="grid h-19.5 min-w-0 cursor-pointer items-center gap-2 border-b border-divider-soft px-3 transition hover:bg-surface-pearl focus:bg-surface-pearl focus:outline-none"
      style={{ gridTemplateColumns }}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect?.()}
          aria-label={`${friend.displayName}を選ぶ`}
          className="h-4 w-4 cursor-pointer accent-accent"
        />
      </div>

      <button
        type="button"
        aria-pressed={attention}
        aria-label={`${friend.displayName}の注目を${attention ? '外す' : '付ける'}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggleAttention?.()
        }}
        className={`rounded p-1 ${attention ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep`}
      >
        <Star aria-hidden="true" className={`h-4 w-4 ${attention ? 'fill-current' : ''}`} />
      </button>

      <div className="flex min-w-0 items-center gap-3">
        {/* アバターは設計 `PhxG6` の 40x40 / r=18。真円（r=20）にしない。 */}
        {friend.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- LINE CDNの利用者画像。
          <img src={friend.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-large bg-avatar-bg object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-large text-sm font-bold text-on-accent" style={{ backgroundColor: avatarColor }}>
            {friend.displayName?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <Link href={`/friends/detail?id=${friend.id}`} onClick={(event) => event.stopPropagation()} title={friend.displayName} className="block truncate text-sm font-bold text-ink hover:text-action hover:underline">
            {friend.displayName}
          </Link>
          <p className="mt-1 truncate text-nano text-ink-faint">登録 {formatDate(friend.createdAt)}</p>
        </div>
      </div>

      {visibleColumns.has('support') ? (
        <div className="min-w-0">
          <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-nano font-bold ${status.className}`}>{status.label}</span>
          <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-nano font-semibold text-ink-secondary">
            <Circle aria-hidden="true" className="h-2 w-2 shrink-0 fill-current" style={{ color: friend.supportMark?.color ?? 'var(--color-ink-disabled)' }} />
            {friend.supportMark?.name ?? 'マークなし'}
          </p>
          {/*
            担当者は設計 `PhxG6` の丸アイコン付き（16x16 / r=8 / 頭文字 10px・800）。
            未割り当ては頭文字が無いので全角ハイフンを置く。空欄にすると
            「読み込み中で出ていない」と見分けが付かなくなる。
          */}
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-nano text-ink-secondary">
            <span
              aria-hidden="true"
              data-operator-avatar={friend.operator ? 'assigned' : 'unassigned'}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-nano font-extrabold ${friend.operator ? 'text-on-accent' : 'bg-avatar-bg text-ink-faint'}`}
              style={friend.operator ? { backgroundColor: avatarTone(friend.operator.name) } : undefined}
            >
              {friend.operator ? (friend.operator.name.charAt(0) || '－') : '－'}
            </span>
            <span className="truncate">担当：{friend.operator?.name ?? '未割り当て'}</span>
          </p>
        </div>
      ) : null}

      {visibleColumns.has('scenario') ? (
        <div className="min-w-0">
          {friend.activeScenario ? (
            <p className="truncate text-xs font-medium text-ink-secondary" title={friend.activeScenario.name}>{friend.activeScenario.name}</p>
          ) : <span className="text-xs text-ink-faint">なし</span>}
        </div>
      ) : null}

      {visibleColumns.has('latest') ? (
        <div className="min-w-0">
          {latest ? (
            <>
              <p className="truncate text-xs text-ink" title={latest.content}>
                {latest.messageType === 'text' ? latest.content : `[${latest.messageType}]`}
              </p>
              <p className="mt-1 text-nano text-ink-faint">{formatDateTime(latest.createdAt)}</p>
            </>
          ) : <><span className="text-xs text-ink-secondary">受信なし</span><p className="mt-1 text-nano text-ink-faint">—</p></>}
        </div>
      ) : null}

      {visibleColumns.has('tags') ? (
        <div className="flex min-w-0 flex-wrap content-center gap-1">
          {friend.tags.slice(0, 2).map((tag, index) => (
            <span key={tag.id} title={tag.name} className={`max-w-full truncate rounded-mini px-2 py-1 text-nano font-semibold ${index === 0 ? 'bg-accent-soft text-accent-hover' : 'bg-chip-alt-soft text-chip-alt'}`}>{tag.name}</span>
          ))}
          {friend.tags.length > 2 ? <span className="rounded-mini bg-avatar-bg px-2 py-1 text-nano text-ink-secondary">+{friend.tags.length - 2}</span> : null}
          {!friend.tags.length ? <span className="text-nano text-ink-disabled">—</span> : null}
        </div>
      ) : null}

      {visibleColumns.has('last') ? (
        <div className="text-center text-xs tabular-nums text-ink-faint" title={formatDateTime(lastContact)}>
          {formatDate(lastContact)}
        </div>
      ) : null}
    </div>
  )
}

function formatDateTime(iso: string): string {
  const trimmed = iso.replace(/(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/, '')
  return trimmed.replace('T', ' ').slice(0, 16)
}

function formatDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/')
}

function avatarTone(name: string): string {
  const palette = [
    'var(--color-avatar-indigo)',
    'var(--color-avatar-blue)',
    'var(--color-avatar-slate)',
    'var(--color-avatar-green)',
  ]
  const index = [...name].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % palette.length
  return palette[index]
}
