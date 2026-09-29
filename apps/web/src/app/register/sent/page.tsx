'use client'

import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import AuthCard from '@/components/auth/auth-card'
import Button from '@/components/shared/button'
import { recallSignupEmail } from '@/lib/auth-email'

/**
 * 確認メールを送りました。★V6 36-4-A（`q32Ao`、カード `r7JPOa`）。
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
      title="確認メールを送りました"
      description={
        <>
          <span className="font-semibold text-ink">{email || '入力したメールアドレス'}</span> 宛てに本登録の URL を送りました。メールを開いて URL を押すと、本登録に進めます。
        </>
      }
    >
      <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-pill bg-accent-soft">
        <Mail className="h-7 w-7 text-accent-deep" />
      </span>
      <div className="flex w-full flex-col gap-1.5 rounded-control bg-surface-pearl px-4 py-3.5">
        <p className="text-label font-bold text-ink">メールが届かないときは</p>
        <p className="text-caption text-ink-secondary">・迷惑メールフォルダを確かめてください</p>
        <p className="text-caption text-ink-secondary">・URL の有効期限は 24 時間です</p>
        <p className="text-caption text-ink-secondary">・アドレスを間違えたときは、もう一度最初から入力してください</p>
      </div>
      <Button href="/register" className="w-full">
        別のメールアドレスで送り直す
      </Button>
    </AuthCard>
  )
}
