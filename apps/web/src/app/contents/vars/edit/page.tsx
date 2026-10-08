'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import EditCommonVarV8 from '@/v8/common-vars-edit/edit'
import FeatureGate from '@/components/feature-gate'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><FeatureGate feature="common_vars"><EditCommonVarV8 /></FeatureGate></Suspense>
}
