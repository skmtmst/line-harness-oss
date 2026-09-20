import FriendAttributesV3Static from '@/components/friend-attributes-v3/friend-attributes-v3-static'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'

export default function FriendAttributesV3Page() {
  return (
    <>
      {/* #975 U101: 固定データの比較画面であることを直リンクでも判別できるようにする。 */}
      <SampleScreenNotice
        what="友だち属性の比較（V3・固定データ）"
        backHref="/tags"
        backLabel="通常の友だち属性へ戻る"
      />
      <FriendAttributesV3Static />
    </>
  )
}
