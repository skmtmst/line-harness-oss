'use client'

import { Suspense } from 'react'
import HqBroadcastCreate from '@/v8/hq-broadcasts/create'

/* ★V8 統括 一括配信を作る（B-37・BBRDb：店の一斉配信と同じ5段＋送るアカウント）。?step=・?id=・?tag=・?folder= は BEHAVIOR.md。 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HqBroadcastCreate />
    </Suspense>
  )
}
