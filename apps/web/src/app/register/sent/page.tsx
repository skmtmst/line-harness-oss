'use client'

import { useEffect, useState } from 'react'
import AuthCard from '@/components/auth/auth-card'
import { recallSignupEmail } from '@/lib/auth-email'

/**
 * 申込受付。★管理画面 36-4-A（`q32Ao`、カード `r7JPOa`）。
 *
 * 入れたメールは同じタブの中だけで持ち回す（URL には載せない）。直接開かれて
 * 何も無いときは「入力したメールアドレス」と出す。
 */
export default function RegisterSentPage() {
  const [email, setEmail] = useState('')
  useEffect(() => setEmail(recallSignupEmail()), [])

  return (
    <AuthCard
      node="q32Ao"
      cardNode="r7JPOa"
      title="お申し込みを受け付けました"
      description={
        <>
          <span className="font-semibold text-ink">{email || '入力したメールアドレス'}</span> でお申し込みを受け付けました。musuboの担当者からの連絡をお待ちください。
        </>
      }
    >
      <div className="flex w-full flex-col gap-3 rounded-control bg-surface-pearl px-4 py-4">
        <p className="text-caption text-ink"><strong>1　申込受付</strong><br />内容を確認します</p>
        <p className="text-caption text-ink"><strong>2　担当者から連絡</strong><br />ご相談内容をお伺いします</p>
        <p className="text-caption text-ink"><strong>3　承認・利用開始</strong><br />ご案内メールから設定します</p>
      </div>
      <p className="w-full text-caption text-ink-secondary">承認が完了するまでは、musuboにログインできません。</p>
    </AuthCard>
  )
}
