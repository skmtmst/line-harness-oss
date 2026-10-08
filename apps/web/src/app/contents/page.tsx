'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import MediaLibraryListV8 from '@/v8/contents/list'
import FeatureGate from '@/components/feature-gate'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><FeatureGate feature="media"><MediaLibraryListV8 /></FeatureGate></Suspense>
}
