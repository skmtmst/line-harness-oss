'use client'
import { Suspense } from 'react'
import MileageV8 from '@/v8/mileage/mileage'



export default function MileagePage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">マイルを読み込んでいます</div>}>
      <MileageThemeBranch />
    </Suspense>
  )
}


function MileageThemeBranch() {

  return <MileageV8 />
}
