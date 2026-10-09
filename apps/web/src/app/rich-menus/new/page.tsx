'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import RichMenuCreateV8 from './create-v8'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><RichMenuCreateV8 /></Suspense>
}
