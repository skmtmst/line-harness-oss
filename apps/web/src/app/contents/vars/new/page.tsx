'use client'
import FeatureGate from '@/components/feature-gate'
import NewCommonVarV8 from '@/v8/common-vars-edit/new'


function NewCommonVarPageSwitch() {

  return <NewCommonVarV8 />
}

export default function NewCommonVarPage() {
  // 直URLでも共通情報オフのaccountには画面を出さない。
  return (
    <FeatureGate feature="common_vars">
      <NewCommonVarPageSwitch />
    </FeatureGate>
  )
}
