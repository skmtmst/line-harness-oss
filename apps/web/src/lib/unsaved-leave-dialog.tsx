'use client'

import ConfirmDialog from '@/components/shared/confirm-dialog'

interface UnsavedLeaveDialogProps {
  open: boolean
  /**
   * 文の真ん中の名詞。「入力した共通情報」「カルーセルの変更」のように渡す。
   * 省いたときは「入力した内容」になる。
   */
  subject?: string
  /**
   * 例外的に文面を丸ごと変えるときだけ使う（取り込み停止・再開の確認など、
   * 定型文では意味が足りない画面用）。通常は subject で足りる。
   */
  description?: string
  /**
   * 例外的に残る側の文言を変えるときだけ使う（通常は「編集を続ける」）。
   */
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 未保存の離脱確認の共通窓。
 *
 * `useUnsavedGuard` の `leaveTarget` と組み合わせて使う。
 * 文言と向きはここで1つに固定する（★V7：残る方が主の緑、離れる方は枠線、
 * 印は付けない）。画面ごとの違いは `subject` の名詞だけにする。
 *
 * ```tsx
 * const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
 * <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した共通情報" onConfirm={confirmLeave} onCancel={cancelLeave} />
 * ```
 *
 * キャンセル・戻るリンクは素の `<a href>` のまま置く（止める役は
 * `useUnsavedGuard` が受け持つ）。`onClick`＋`router.push` にすると
 * 止められないので使わない。
 */
export function UnsavedLeaveDialog({
  open,
  subject = '入力した内容',
  description,
  cancelLabel = '編集を続ける',
  busy = false,
  onConfirm,
  onCancel,
}: UnsavedLeaveDialogProps) {
  return (
    <ConfirmDialog
      primaryAction="cancel"
      open={open}
      title="保存していない変更があります"
      description={description ?? `このまま移動すると、${subject}は失われます。保存せずに移動しますか？`}
      confirmLabel="保存せずに移動"
      cancelLabel={cancelLabel}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
