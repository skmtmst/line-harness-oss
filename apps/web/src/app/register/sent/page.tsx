'use client'

import AuthCard from '@/components/auth/auth-card'
import styles from './sent.module.css'

/**
 * 申込受付。★管理画面 36-4-A（`q32Ao`、カード `r7JPOa`）。
 *
 * 入れたメールは同じタブの中だけで持ち回す（URL には載せない）。直接開かれて
 * 何も無いときは「入力したメールアドレス」と出す。
 */
export default function RegisterSentPage() {
  return (
    <AuthCard
      node="Wbv2v"
      applicationFlow="sent"
      title="お申し込みを受け付けました"
      description="入力されたメールアドレスに受付内容をお送りします。musuboの担当者からの連絡をお待ちください。"
    >
      <ol className={styles.steps}>
        <li><span>1</span><p><strong>申込受付</strong><small>内容を確認します</small></p></li>
        <li><span>2</span><p><strong>担当者から連絡</strong><small>ご相談内容をお伺いします</small></p></li>
        <li><span>3</span><p><strong>承認・利用開始</strong><small>ご案内メールから設定します</small></p></li>
      </ol>
      <p className={styles.restriction}>承認が完了するまでは、musuboにログインできません。</p>
    </AuthCard>
  )
}
