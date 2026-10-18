'use client'

import { Suspense } from 'react'
import { DetailLoading } from '@/components/templates/detail-page'
import RichMenuSampleV8 from '@/v8/rich-menu-sample/sample'

/* 見本のリッチメニュー（cAaGY）。`?style=restaurant|salon|consult|lesson` で見本を選ぶ（無ければ今のアカウントのスタイル）。 */
export default function RichMenuSamplePage() {
  return <Suspense fallback={<DetailLoading />}><RichMenuSampleV8 /></Suspense>
}
