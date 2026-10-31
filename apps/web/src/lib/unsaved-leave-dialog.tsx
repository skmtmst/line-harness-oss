'use client'

import { useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog, { DialogActions } from '@/components/shared/dialog'

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
  /** 未指定なら従来の保存・破棄の文言を使う。 */
  saveLabel?: string
  discardLabel?: string
  /** 呼出側が持つ失敗理由を、開いている窓の中に出す。 */
  error?: string
  busy?: boolean
  /**
   * 「保存して移る」を出す（★管理画面 sTJsh §5）。保存が通ったらそのまま移動を
   * 続ける。失敗したら画面に留まるので、保存側は従来どおり理由を出す。
   * 保存に async 処理が要る画面だけ渡す。省略すると「編集を続ける」＋
   * 「保存せずに移る」の2択のまま。
   */
  saveDisabled?: boolean
  saveLockedReason?: string
  onSave?: () => Promise<boolean>
  /** 保存成功後だけ使う。呼出側が離脱の守りを解除し窓を閉じて移動する。省略時は onConfirm。 */
  onSavedLeave?: () => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 未保存の離脱確認の共通窓。
 *
 * `useUnsavedGuard` の `leaveTarget` と組み合わせて使う。
 * 文言と向きはここで1つに固定する（★管理画面：残る方が主の緑、離れる方は枠線、
 * 印は付けない）。通常の違いは `subject`、保存・破棄の意味が違う場合だけ任意の文言と成功後の移動を渡す。
 *
 * `tsx
 * const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
 * <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した共通情報" onConfirm={confirmLeave} onCancel={cancelLeave} />
 * `
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
  saveLabel = '保存して移る',
  discardLabel = '保存せずに移る',
  error,
  busy = false,
  onSave,
  onSavedLeave,
  saveDisabled = false,
  saveLockedReason,
  onConfirm,
  onCancel,
}: UnsavedLeaveDialogProps) {
  const [savingLeave, setSavingLeave] = useState(false)
  const saveBlocked = useRef(false)
  saveBlocked.current = saveDisabled || Boolean(saveLockedReason)
  const body = description ?? `このまま移ると、${subject}が消えます。`

  // 「保存して移る」があるとき: 移る系の2択だけ出し、残る口は右上の×（UI-25）
  if (onSave) {
    const saveAndLeave = async () => {
      if (savingLeave || busy || saveBlocked.current) return
      setSavingLeave(true)
      try {
        const saved = await onSave()
        /*
         * 保存が通ればそのまま移動。通らなければ画面へ戻す（★管理画面 sTJsh §5
         * 「失敗したら画面に戻る」）。理由は画面側が従来どおり欄の下に出す。
         */
        if (saved) (onSavedLeave ?? onConfirm)()
        else onCancel()
      } finally {
        setSavingLeave(false)
      }
    }
    return (
      <Dialog
        open={open}
        title="保存していない変更があります"
        description={body}
        error={error}
        busy={busy || savingLeave}
        onCancel={onCancel}
        confirmation
        compact
        footer={
          <DialogActions>
            <Button variant="secondary" onClick={onConfirm} disabled={busy || savingLeave}>
              {discardLabel}
            </Button>
            <Button variant="primary" onClick={() => void saveAndLeave()} disabled={busy || saveDisabled} lockedReason={saveLockedReason} busy={savingLeave} busyLabel="保存中…">
              {saveLabel}
            </Button>
          </DialogActions>
        }
      />
    )
  }

  return (
    <ConfirmDialog
      primaryAction="cancel"
      open={open}
      title="保存していない変更があります"
      description={body}
      error={error}
      confirmLabel={discardLabel}
      cancelLabel={cancelLabel}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
