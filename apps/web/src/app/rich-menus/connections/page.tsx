'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import RichMenuConnectionsV8 from '@/v8/rich-menus/connections'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><RichMenuConnectionsV8 /></Suspense>
}
