'use client'

/* リッチメニュータブ。変更履歴はまだ記録していない。今の割り当ては概要タブの「リッチメニュー」欄。 */
import { LayoutGrid } from 'lucide-react'
import EmptyTab from './empty-tab'

export default function RichMenuTab() {
  return (
    <EmptyTab
      icon={<LayoutGrid size={17} />}
      title="この友だちのリッチメニュー変更履歴はまだ記録されていません"
      text="現在の割り当ては概要タブの「リッチメニュー」欄で確認できます。"
      actions={[{ label: 'リッチメニュー一覧を見る ↗', href: '/rich-menus' }]}
    />
  )
}
