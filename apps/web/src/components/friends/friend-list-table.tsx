'use client'

import { useEffect, useRef } from 'react'
import type { FriendListItem } from '@/lib/api'
import FriendListRow from './friend-list-row'

interface Props {
  friends: FriendListItem[]
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: (select: boolean) => void
}

const GRID = 'grid-cols-[30px_minmax(150px,1.35fr)_minmax(94px,.72fr)_minmax(105px,.78fr)_minmax(160px,1.55fr)_minmax(130px,1.05fr)_88px_58px]'
const RESPONSIVE_GRID = 'lg:grid-cols-[30px_minmax(150px,1.35fr)_minmax(94px,.72fr)_minmax(105px,.78fr)_minmax(160px,1.55fr)_minmax(130px,1.05fr)_88px_58px]'

export default function FriendListTable({
  friends,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: Props) {
  const checkboxRef = useRef<HTMLInputElement>(null)
  const selectedCount = friends.filter((friend) => selectedIds?.has(friend.id)).length
  const allSelected = friends.length > 0 && selectedCount === friends.length

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = selectedCount > 0 && !allSelected
  }, [allSelected, selectedCount])

  if (friends.length === 0) {
    return (
      <div className="rounded-[14px] border border-[#DADDE2] bg-white p-12 text-center shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
        <p className="text-sm font-medium text-[#565F59]">条件に合う友だちが見つかりません</p>
        <p className="mt-1 text-xs text-[#8B938D]">検索条件を外すか、別のキーワードでお試しください。</p>
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white shadow-[1px_1px_2px_rgba(29,29,31,0.13)]" data-design="V4FriendTable">
      <div className={`hidden min-w-0 gap-2 border-b border-[#DADDE2] bg-[#F6F6F8] px-3 py-2.5 text-[11px] font-semibold text-[#565F59] lg:grid ${GRID}`}>
        <div>
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onToggleAll?.(event.target.checked)}
            aria-label="表示中の友だちをすべて選ぶ"
            className="h-4 w-4 cursor-pointer accent-[#07C653]"
          />
        </div>
        <div className="truncate">友だち</div>
        <div className="truncate">対応 / 担当</div>
        <div className="truncate">シナリオ</div>
        <div className="truncate">最新メッセージ</div>
        <div className="truncate">タグ・属性</div>
        <div className="truncate">最終接触</div>
        <div className="text-right">操作</div>
      </div>
      {friends.map((friend) => (
        <FriendListRow
          key={friend.id}
          friend={friend}
          selected={selectedIds?.has(friend.id)}
          onToggleSelect={() => onToggleSelect?.(friend.id)}
          gridClass={RESPONSIVE_GRID}
        />
      ))}
    </section>
  )
}
