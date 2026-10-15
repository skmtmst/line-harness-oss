'use client'

/* 登録済みのリマインダへ、IDだけで絞り込みを引き継ぐ。 */
import { Bell } from 'lucide-react'
import EmptyTab from './empty-tab'
import { friendFilterHref } from '@/components/shared/friend-filter-band'

export default function RemindersTab({ friendId }: { friendId: string }) {
  return (
    <EmptyTab
      icon={<Bell size={17} />}
      title="この友だちのリマインダ"
      text="登録されているリマインダを一覧で確認できます。"
      actions={[{ label: 'この友だちのリマインダを見る ↗', href: friendFilterHref('/reminders', friendId) }]}
    />
  )
}
