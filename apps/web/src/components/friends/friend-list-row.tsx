'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FriendListItem } from '@/lib/api'

interface Props {
  friend: FriendListItem
  selected?: boolean
  onToggleSelect?: () => void
  gridClass: string
}

function statusView(status: FriendListItem['chatStatus']) {
  if (status === 'unread') return { label: '未対応', className: 'bg-[#FFF1F2] text-[#C3323B]' }
  if (status === 'in_progress') return { label: '対応中', className: 'bg-[#FFF5DE] text-[#94600A]' }
  return { label: '対応済み', className: 'bg-[#EEF0F2] text-[#565F59]' }
}

export default function FriendListRow({ friend, selected, onToggleSelect, gridClass }: Props) {
  const router = useRouter()
  const status = statusView(friend.chatStatus)
  const latest = friend.latestIncomingMessage
  const lastContact = latest?.createdAt ?? friend.latestOutgoingAt ?? friend.createdAt

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
      className={`grid min-w-0 cursor-pointer grid-cols-[30px_minmax(0,1fr)_auto] gap-2 border-b border-[#EAEBED] px-3 py-3 transition last:border-b-0 hover:bg-[#F9FAFA] focus:bg-[#F9FAFA] focus:outline-none lg:items-center ${gridClass}`}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect?.()}
          aria-label={`${friend.displayName}を選ぶ`}
          className="h-4 w-4 cursor-pointer accent-[#07C653]"
        />
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        {friend.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- LINE CDNの利用者画像。
          <img src={friend.pictureUrl} alt="" className="h-9 w-9 shrink-0 rounded-full bg-[#EEF0F2] object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E9F9EF] text-sm font-bold text-[#079B45]">
            {friend.displayName?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <Link href={`/friends/detail?id=${friend.id}`} onClick={(event) => event.stopPropagation()} title={friend.displayName} className="block truncate text-sm font-semibold text-[#1D1D1F] hover:text-[#0067D9] hover:underline">
            {friend.displayName}
          </Link>
          <p className="mt-0.5 truncate text-[10px] text-[#8B938D]">登録 {formatDate(friend.createdAt)}</p>
          {!friend.isFollowing ? <span className="mt-1 inline-flex rounded-full bg-[#FFF1F2] px-2 py-0.5 text-[10px] font-medium text-[#C3323B]">ブロック / 非表示</span> : null}
        </div>
      </div>

      <div className="flex justify-end lg:block">
        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
        <p className="mt-1 hidden truncate text-[10px] text-[#8B938D] lg:block">担当 未設定</p>
      </div>

      <div className="col-start-2 min-w-0 lg:col-auto">
        {friend.activeScenario ? (
          <>
            <p className="truncate text-xs font-medium text-[#0067D9]" title={friend.activeScenario.name}>{friend.activeScenario.name}</p>
            <p className="mt-0.5 text-[10px] text-[#8B938D]">{friend.activeScenario.status === 'active' ? '配信中' : '停止中'}</p>
          </>
        ) : <span className="text-xs text-[#8B938D]">なし</span>}
      </div>

      <div className="col-span-2 col-start-2 min-w-0 lg:col-auto lg:col-span-1">
        {latest ? (
          <>
            <p className="line-clamp-2 text-xs leading-5 text-[#565F59]" title={latest.content}>
              {latest.messageType === 'text' ? latest.content : `[${latest.messageType}]`}
            </p>
            <p className="mt-0.5 text-[10px] text-[#8B938D]">{formatDateTime(latest.createdAt)}</p>
          </>
        ) : <span className="text-xs text-[#8B938D]">受信なし</span>}
      </div>

      <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap content-center gap-1 lg:col-auto lg:col-span-1">
        {friend.tags.slice(0, 2).map((tag) => (
          <span key={tag.id} title={tag.name} className="max-w-full truncate rounded-full bg-[#E9F9EF] px-2 py-1 text-[10px] font-medium text-[#079B45]">{tag.name}</span>
        ))}
        {friend.tags.length > 2 ? <span className="rounded-full bg-[#EEF0F2] px-2 py-1 text-[10px] text-[#565F59]">+{friend.tags.length - 2}</span> : null}
        {!friend.tags.length && friend.firstTrackedLinkName ? <span title={friend.firstTrackedLinkName} className="max-w-full truncate text-[10px] text-[#565F59]">{friend.firstTrackedLinkName}</span> : null}
        {!friend.tags.length && !friend.firstTrackedLinkName ? <span className="text-[10px] text-[#B8BCC2]">—</span> : null}
      </div>

      <div className="col-start-2 text-xs tabular-nums text-[#565F59] lg:col-auto lg:text-center" title={formatDateTime(lastContact)}>
        {formatDate(lastContact)}
      </div>
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
