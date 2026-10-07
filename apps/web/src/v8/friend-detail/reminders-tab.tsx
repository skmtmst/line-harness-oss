'use client'

/* リマインダタブ。この友だちに届くリマインダだけを集めた画面はまだ無い。 */
import { Bell } from 'lucide-react'
import EmptyTab from './empty-tab'

export default function RemindersTab() {
  return (
    <EmptyTab
      icon={<Bell size={17} />}
      title="この友だちに届くリマインダだけを集めた画面はまだありません"
      text="設定済みのリマインダは一覧で確認できます。"
      actions={[{ label: 'リマインダ一覧を見る ↗', href: '/reminders' }]}
    />
  )
}
