import FriendAttributesV2TagList, { FRIEND_ATTRIBUTES_V2_QA_FIXTURE } from '@/components/friend-attributes-v2/tag-list-v2'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'

export default function FriendAttributesV2VisualQaPage() {
  return (
    <>
      {/* #975 U101: 固定データの検証画面であることを直リンクでも判別できるようにする。 */}
      <SampleScreenNotice
        what="友だち属性（V2）の表示確認"
        backHref="/tags"
        backLabel="通常の友だち属性へ戻る"
      />
      <FriendAttributesV2TagList fixture={FRIEND_ATTRIBUTES_V2_QA_FIXTURE} />
    </>
  )
}
