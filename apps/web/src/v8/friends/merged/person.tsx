'use client'

/*
 * ★V8 統合ユーザーの詳細（Pencil `Hn9eE`）。
 * 読み込み・保存・解除は今と同じ口（components/merged-person の useMergedPerson）。
 */
import MergedPersonDetailViewV8 from '@/components/merged-person/merged-person-detail-v8'

export default function MergedPersonV8({ personId, onClose }: { personId: string; onClose: () => void }) {
  return <MergedPersonDetailViewV8 personId={personId} onClose={onClose} />
}
