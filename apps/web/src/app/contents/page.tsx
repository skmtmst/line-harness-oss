'use client'
import FeatureGate from '@/components/feature-gate'
import MediaLibraryListV8 from '@/v8/contents/list'


function MediaLibraryPageSwitch() {

  return <MediaLibraryListV8 />
}

export default function MediaLibraryPage() {
  // 直URLでも登録メディアオフのaccountには画面を出さない。
  return (
    <FeatureGate feature="media">
      <MediaLibraryPageSwitch />
    </FeatureGate>
  )
}
