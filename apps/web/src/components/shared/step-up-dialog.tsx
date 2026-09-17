'use client'

import React, { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import Dialog from './dialog'

interface StepUpDialogProps {
  open: boolean
  /** 何のための再認証かを運用者の言葉で。例: '権限を変更する' */
  action: string
  busy?: boolean
  error?: string
  /** 6桁コードが確定したら呼ぶ。親が step-up grant の取得と本操作のやり直しを行う。 */
  onSubmit: (code: string) => void
  onCancel: () => void
}

/**
 * 高危険操作の直前再認証ダイアログ（N-427）。
 *
 * 緊急停止・権限変更など、428 `STEP_UP_REQUIRED` で止まった操作の前に立てる。
 * 6桁コードを受け取るだけで、grant 取得と本操作のやり直しは呼び出し側が持つ。
 */
export default function StepUpDialog({ open, action, busy = false, error, onSubmit, onCancel }: StepUpDialogProps) {
  const [code, setCode] = useState('')
  useEffect(() => { if (open) setCode('') }, [open])
  const ready = /^\d{6}$/.test(code)
  return (
    <Dialog
      open={open}
      title="認証アプリで本人確認"
      description={`${action}には、権限を持つ本人の確認が必要です。この操作専用に、5分以内に1回だけ使える6桁コードを入力してください。`}
      confirmLabel="本人確認して実行"
      busy={busy}
      error={error}
      titleIcon={<KeyRound size={22} />}
      onConfirm={ready ? () => onSubmit(code) : undefined}
      onCancel={onCancel}
    >
      <label className="mt-1 block text-sm font-medium text-ink">
        認証アプリに表示された6桁コード
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoFocus
          disabled={busy}
          className="mt-2 h-12 w-full rounded-control border border-hairline px-4 text-center text-xl font-bold tracking-[0.5em] outline-none focus:border-accent"
          placeholder="000000"
        />
      </label>
    </Dialog>
  )
}
