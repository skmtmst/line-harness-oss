'use client'

import { Suspense } from 'react'
import HqBroadcastCreate from '@/v8/hq-broadcasts/create'

/* ★V8 統括 一括配信を作る（提案 E-9 `p17Qku`）。?tag=<アカウントのタグ> で宛先を選んだ状態から始められる。 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HqBroadcastCreate />
    </Suspense>
  )
}
