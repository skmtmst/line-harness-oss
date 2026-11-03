'use client'

import V8RewardEdit from '@/v8/mileage/reward-edit'
import EditorSourceGuard from '@/v8/mileage/editor-source-guard'

export default function MileageRewardEditorPage() {
  return <EditorSourceGuard><V8RewardEdit /></EditorSourceGuard>
}
