'use client'
import { Suspense } from 'react'
import FeatureGate from '@/components/feature-gate'
import EditCommonVarV8 from '@/v8/common-vars-edit/edit'


function EditCommonVarPageSwitch() {

  return <EditCommonVarV8 />
}

export default function EditCommonVarPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      {/* 直URLでも共通情報オフのaccountには画面を出さない。 */}
      <FeatureGate feature="common_vars">
        <EditCommonVarPageSwitch />
      </FeatureGate>
    </Suspense>
  )
}
