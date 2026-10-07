'use client'

/* マイルタブ。残高と履歴はマイル画面（この人のマイル詳細）で見る。 */
import { Star } from 'lucide-react'
import EmptyTab from './empty-tab'

export default function MilesTab({ friendId }: { friendId: string }) {
  return (
    <EmptyTab
      icon={<Star size={17} />}
      title="この友だちのマイルはマイル画面で見られます"
      text="マイル残高と履歴は、マイル画面で確認できます。"
      actions={[{ label: 'マイルを確認 ↗', href: `/mileage/friends/detail?id=${encodeURIComponent(friendId)}` }]}
    />
  )
}
