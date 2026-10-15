import type { Tag } from '@line-crm/shared'
import type { ApiBroadcast } from '@/lib/api'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { BroadcastStepKey } from './broadcast-steps'
export interface BroadcastFormProps {
  tags: Tag[]
  /**
   * R581: タグ候補の取得状態。呼び側（作成ページ）が持つ。
   * 取得失敗と真の0件を分け、同じ画面で再試行できるようにする。
   * 未指定は取得ずみ扱い（一覧の埋め込みフォームは従来どおり）。
   */
  tagsStatus?: 'loading' | 'ready' | 'error'
  /** R581: タグ候補の再取得。入力はフォームが持つので、再試行で消えない。 */
  onRetryTags?: () => void
  /** 作成された実物。予約だけを完了画面へ送り、下書きと取り違えない。 */
  onSuccess: (broadcast: ApiBroadcast) => void
  /**
   * BROADCAST-16: 「下書き保存」でフォームが閉じない保存にも呼ぶ。
   * 呼び側は一覧・フォルダ件数を読み直す（保存した下書きが未分類へ
   * 増えるのに、再訪しないと件数が古いままだった）。
   */
  onDraftSaved?: (broadcast: ApiBroadcast) => void
  onCancel: () => void
  openTemplatePickerInitially?: boolean
  initialTemplateId?: string | null
  initialContentTemplateId?: string | null
  initialCondition?: SegmentCondition | null
  /** 分析画面から渡された一時対象者。人数・期限はAPIで読み直したもの。 */
  audienceNotice?: { memberCount: number; expiresAt: string; label?: string } | null
  initialScheduledDate?: string
  initialScheduledTime?: string
  /** 正本の `?step=`。未指定は一覧内の従来フォームとして全節を表示する。 */
  currentStep?: BroadcastStepKey | null
  onStepChange?: (step: BroadcastStepKey) => void
  /** visual-qa-accountでだけ使う、Pencilの8月キャンペーン完成状態。 */
  visualQaAugustCampaign?: boolean
}
