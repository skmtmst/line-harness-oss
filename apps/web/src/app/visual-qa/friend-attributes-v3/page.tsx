import FriendAttributesV3Static from '@/components/friend-attributes-v3/friend-attributes-v3-static'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'

export default function FriendAttributesV3VisualQaPage() {
  return (
    <>
      {/* #975 U101: 固定データの検証画面であることを直リンクでも判別できるようにする。 */}
      <SampleScreenNotice
        what="友だち属性（V3）の表示確認"
        backHref="/tags"
        backLabel="通常の友だち属性へ戻る"
      />
      <FriendAttributesV3Static />
    </>
  )
}
