'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'

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
  /**
   * 「保存して移る」を出す（★V7 sTJsh §5）。保存が通ったらそのまま移動を
   * 続ける。失敗したら画面に留まるので、保存側は従来どおり理由を出す。
   * 保存に async 処理が要る画面だけ渡す。省略すると「編集を続ける」＋
   * 「保存せずに移る」の2択のまま。
   */
  onSave?: () => Promise<boolean>
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
  onSave,
  onConfirm,
  onCancel,
}: UnsavedLeaveDialogProps) {
  const [savingLeave, setSavingLeave] = useState(false)
  const body = description ?? `このまま移ると、${subject}が消えます。`

  // 「保存して移る」があるとき: 移る系の2択だけ出し、残る口は右上の×（UI-25）
  if (onSave) {
    const saveAndLeave = async () => {
      if (savingLeave || busy) return
      setSavingLeave(true)
      try {
        const saved = await onSave()
        /*
         * 保存が通ればそのまま移動。通らなければ画面へ戻す（★V7 sTJsh §5
         * 「失敗したら画面に戻る」）。理由は画面側が従来どおり欄の下に出す。
         */
        if (saved) onConfirm()
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
        busy={busy || savingLeave}
        onCancel={onCancel}
        confirmation
        compact
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onConfirm} disabled={busy || savingLeave}>
              保存せずに移る
            </Button>
            <Button variant="primary" onClick={() => void saveAndLeave()} disabled={busy} busy={savingLeave} busyLabel="保存中…">
              保存して移る
            </Button>
          </div>
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
      confirmLabel="保存せずに移る"
      cancelLabel={cancelLabel}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
