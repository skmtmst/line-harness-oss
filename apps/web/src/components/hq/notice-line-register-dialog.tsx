'use client'

import NoticeLineDialogV8 from '@/v8/hq/notice-line-dialog'

/** 登録完了時の自動表示も、統括画面と同じPenの案内を使う。 */
export default function NoticeLineRegisterDialog({ open, onClose, quietWhenUnavailable = true }: {
  open: boolean
  onClose: () => void
  quietWhenUnavailable?: boolean
}) {
  return <NoticeLineDialogV8 open={open} onClose={onClose} quietWhenUnavailable={quietWhenUnavailable} />
}
