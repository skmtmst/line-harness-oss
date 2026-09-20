'use client'

import FriendAttributesV2TagList from '@/components/friend-attributes-v2/tag-list-v2'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'

/** 現行 /tags を残したまま、新しい表示層だけを検証する移行用画面。 */
export default function FriendAttributesV2Page() {
  return (
    <>
      {/* #975 U101: 検証用の画面であることを直リンクでも判別できるようにする。 */}
      <SampleScreenNotice
        what="友だち属性の新しい並び（検証用）"
        backHref="/tags"
        backLabel="通常の友だち属性へ戻る"
      />
      <FriendAttributesV2TagList />
    </>
  )
}
