'use client'

import React, { useEffect, useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import Dialog from './dialog'
import OtpInput from './otp-input'

interface StepUpDialogProps {
  open: boolean
  /** 何のための再認証かを運用者の言葉で。例: '権限を変更する' */
  action: string
  /**
   * 再確認の聞き方（V-1）。2段階認証を使っている人は 'totp'（6桁コード）、
   * 使っていない人は 'password'。/api/auth/session の stepUpMethod を渡す。
   * どちらも未設定は 'none'（R502: 入力欄も実行ボタンも出さず案内だけ出す）。
   */
  method?: 'totp' | 'password' | 'none'
  busy?: boolean
  error?: string
  /** 入力が確定したら呼ぶ。親が step-up grant の取得と本操作のやり直しを行う。 */
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * 高危険操作の直前再認証ダイアログ（N-427 → V-1）。
 *
 * 緊急停止・権限変更・LINE接続の変更・配信の承認など、STEP_UP_REQUIRED で
 * 止まった操作の前に立てる。聞くのは本人の設定で決まり、二段階認証があれば
 * 6桁コード、なければパスワード。grant 取得と本操作のやり直しは呼び出し側。
 */
export default function StepUpDialog({ open, action, method = 'totp', busy = false, error, onSubmit, onCancel }: StepUpDialogProps) {
  const [value, setValue] = useState('')
  const labelId = useId()
  useEffect(() => { if (open) setValue('') }, [open])
  const isTotp = method === 'totp'
  const isNone = method === 'none'
  const ready = !isNone && (isTotp ? /^\d{6}$/.test(value) : value.length > 0)
  // R502: 方法未設定では使えない入力欄・実行ボタンを出さない。案内と設定への導線だけ出す。
  if (isNone) {
    return (
      <Dialog
        open={open}
        title="本人確認の方法が未設定です"
        description={`${action}には本人確認が必要です。先に確認方法を設定してください。`}
        busy={false}
        titleIcon={<KeyRound size={22} />}
        onCancel={onCancel}
        cancelLabel="閉じる"
      >
        <p className="text-sm leading-6 text-ink-secondary">
          認証アプリ（6桁コード）またはパスワードのどちらかを登録すると、この操作へ進めます。
        </p>
        <p className="mt-2 text-sm font-bold">
          <a href="/staff" className="text-action hover:underline">確認方法を設定する</a>
        </p>
      </Dialog>
    )
  }
  return (
    <Dialog
      open={open}
      title={isTotp ? '認証アプリで本人確認' : 'パスワードで本人確認'}
      description={isTotp
        ? `${action}には、権限を持つ本人の確認が必要です。この操作専用に、5分以内に1回だけ使える6桁コードを入力してください。`
        : `${action}には、権限を持つ本人の確認が必要です。この操作専用に、5分以内に1回だけ使える確認を発行するため、パスワードを入力してください。`}
      confirmLabel="本人確認して実行"
      busy={busy}
      error={error}
      titleIcon={<KeyRound size={22} />}
      onConfirm={ready ? () => onSubmit(value) : undefined}
      onCancel={onCancel}
    >
      {isTotp ? (
        <>
          <p id={labelId} className="mt-1 block text-sm font-medium text-ink">認証アプリに表示された6桁コード</p>
          {/* ★V7 共通 認証コード入力（xHzFK）。実行はこれまでどおり「本人確認して実行」で行う。 */}
          <div className="mt-2">
            <OtpInput
              value={value}
              onChange={setValue}
              labelledBy={labelId}
              invalid={Boolean(error)}
              disabled={busy}
              autoFocus
            />
          </div>
        </>
      ) : (
        <>
          <label htmlFor={labelId} className="mt-1 block text-sm font-medium text-ink">パスワード</label>
          <div className="mt-2">
            <input
              id={labelId}
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              autoFocus
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              className="w-full rounded-control border border-shell-gray bg-canvas px-3 py-2 text-sm text-ink focus:border-action"
            />
          </div>
        </>
      )}
    </Dialog>
  )
}
