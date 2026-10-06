'use client'

/* 配信・シナリオタブ。この友だちに届いている配信の一覧はまだ取る口が無い。登録の操作はここから（NEXT-09）。 */
import { Workflow } from 'lucide-react'
import EmptyTab from './empty-tab'

export default function ScenarioTab({ canEnroll, onEnroll }: { canEnroll: boolean; onEnroll: () => void }) {
  return (
    <EmptyTab
      icon={<Workflow size={17} />}
      title="この友だちに届いている配信・シナリオの一覧はまだ見られません"
      text="この友だちをシナリオへ登録する操作はここからできます。"
      actions={[
        // POST /api/scenarios/:id/enroll/:friendId はオーナー・管理者専用。
        ...(canEnroll ? [{ label: 'この友だちをシナリオに登録する', onClick: onEnroll, primary: true }] : []),
        { label: 'シナリオ一覧を見る ↗', href: '/scenarios' },
      ]}
    />
  )
}
