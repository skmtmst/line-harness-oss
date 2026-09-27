'use client'

import React, { useState } from 'react'
import { api, ApiError, type StepUpPurpose } from '@/lib/api'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import StepUpDialog from '@/components/shared/step-up-dialog'

export type StepUpRequest = {
  purpose: StepUpPurpose
  /** 運用者の言葉で操作名。例: 'LINEアカウントを停止する' */
  action: string
  /** grant を受け取って本操作をやり直す関数 */
  retry: (token: string) => Promise<void>
}

/** STEP_UP_REQUIRED で止まったか。401/428 両方でこの code が来る。 */
export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'STEP_UP_REQUIRED'
}

type PendingStepUp = { purpose: StepUpPurpose; action: string; resolve: (token: string | null) => void }

/**
 * onSave のような「async関数の途中で待つ」画面向けの窓。
 *
 * `gate()` が呼ばれると V-1 ダイアログを開き、本人確認が済むか窓を閉じるまで
 * Promise で待つ。戻り値は発行された grant token（閉じられたら null）。
 * フォームシェルが onSave を呼ぶ形でも、その場で待ってやり直せる。
 */
export function useStepUpGate(): {
  gate: (purpose: StepUpPurpose, action: string) => Promise<string | null>
  prompt: React.ReactNode
} {
  const [pending, setPending] = useState<PendingStepUp | null>(null)
  const gate = (purpose: StepUpPurpose, action: string) =>
    new Promise<string | null>((resolve) => setPending({ purpose, action, resolve }))
  const prompt = pending ? (
    <StepUpPrompt
      request={{
        purpose: pending.purpose,
        action: pending.action,
        retry: async (token) => { pending.resolve(token) },
      }}
      onDone={() => setPending(null)}
      onClose={() => { pending.resolve(null); setPending(null) }}
    />
  ) : null
  return { gate, prompt }
}

/**
 * V-1: 大事な操作の前に立てる再確認の窓（共通部品）。
 *
 * 聞き方はセッションが持つ本人の設定（2段階認証なら6桁、無ければパスワード）
 * で決まる。設定がどちらも無い人には案内だけを出す。
 */
export default function StepUpPrompt({
  request,
  onDone,
  onClose,
}: {
  request: StepUpRequest
  onDone: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const method = readSessionSnapshot()?.stepUpMethod ?? 'totp'
  const submit = async (value: string) => {
    // 確認の方法が無い人（2段階認証もパスワードも未設定）は送らない。案内だけ出す。
    if (busy || method === 'none') return
    setBusy(true)
    setError('')
    try {
      const res = await api.auth.stepUp({ method, value, purpose: request.purpose })
      if (!res.success) throw new Error(res.error)
      await request.retry(res.data.token)
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '確認できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <StepUpDialog
      open
      action={request.action}
      method={method === 'password' ? 'password' : 'totp'}
      busy={busy}
      error={method === 'none' ? 'この操作には二段階認証またはパスワードの設定が必要です。設定画面で登録してください。' : error}
      onSubmit={(value) => void submit(value)}
      onCancel={onClose}
    />
  )
}
