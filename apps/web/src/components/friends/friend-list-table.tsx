'use client'

import { useState } from 'react'
import type { Tag } from '@line-crm/shared'
import type { FriendListItem } from '@/lib/api'
import FriendListRow from './friend-list-row'
import NenFriendDetailDrawer from './nen-friend-detail-drawer'

interface Props {
  friends: FriendListItem[]
  allTags: Tag[]
  onRefresh: () => void
}

export default function FriendListTable({ friends, allTags, onRefresh }: Props) {
  const [detailFriend, setDetailFriend] = useState<FriendListItem | null>(null)

  if (friends.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">友だちが見つかりません</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header sits inside the same overflow container as the body so the
          column labels stay aligned with their values when the user scrolls
          horizontally on narrower viewports (e.g. desktop with sidebar open
          and the body forced to min-w-[900px]). */}
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          {/*
            列は設計 `V2 2-2 友だち` の並び。名前が先頭。
            対応マークを先頭に置くと、一覧を上から追うときに
            名前より先に記号が目に入り、誰の行か分かるのが遅れる。

            最後の「最終接触」は、放置されている人を見つけるための列。
            設計では最も右にあり、対応マークと対で読む。
          */}
          <div className="hidden lg:grid grid-cols-[220px_80px_120px_1fr_160px_110px_88px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>名前</div>
            <div>対応マーク</div>
            <div>シナリオ</div>
            <div>受信メッセージ</div>
            <div>★つきタグ・友だち情報</div>
            <div>最終接触</div>
            <div className="text-right">詳細</div>
          </div>
          {friends.map((friend) => (
              <div key={friend.id}>
                <FriendListRow
                  friend={friend}
                  onDetailClick={() => setDetailFriend(friend)}
                />
              </div>
          ))}
        </div>
      </div>
      {detailFriend && <NenFriendDetailDrawer friend={detailFriend} allTags={allTags} onTagsChanged={onRefresh} onClose={() => setDetailFriend(null)} />}
    </div>
  )
}
