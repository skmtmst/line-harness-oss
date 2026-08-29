'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'
import MileageRewardEditor from '../reward-editor'

function EditMileageRewardContent() {
  const id = useSearchParams().get('id')
  if (!id) {
    return <ListState kind="error" title="使い道を開けませんでした" description="編集する使い道を選び直してください。" />
  }
  return <MileageRewardEditor rewardId={id} />
}

export default function EditMileageRewardPage() {
  return <Suspense fallback={<ListState kind="loading" title="使い道を読み込んでいます" description="このまま少しお待ちください。" />}><EditMileageRewardContent /></Suspense>
}
