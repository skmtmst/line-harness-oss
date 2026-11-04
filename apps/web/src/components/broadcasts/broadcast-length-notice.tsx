import Notice from '@/components/shared/notice'
import type { messageLengthNotice } from './message-limits'

/** 下書きから長すぎる本文を読み込んだ場合も、保存前に理由を示す。 */
export function BroadcastLengthNotice({ visible, notice }: { visible: boolean; notice: ReturnType<typeof messageLengthNotice> }) {
  if (!visible || notice.tone !== 'error') return null
  return <Notice tone="danger" className="mb-3">
    <p className="text-danger text-sm font-bold">{notice.title}</p>
    <p className="text-danger mt-1 text-xs">{notice.description}</p>
  </Notice>
}
