'use client'

import AuthCard from '@/components/auth/auth-card'
import PlatformNotices from '@/components/hq/platform-notices'
import Button from '@/components/shared/button'

/** 契約先の利用停止案内。V6正本 `CXFjb9` が唯一の見た目の正本。 */
export default function TenantSuspended() {
  return (
    <AuthCard
      node="CXFjb9"
      cardNode="m6Qroc"
      title="現在ご利用いただけません"
      description="ご契約の利用が停止されています。"
    >
      <div className="w-full">
        <div data-design-node="R7p6Ba" className="rounded-control border border-status-danger bg-status-danger-soft px-6 py-5 text-left">
          <p className="text-caption text-ink-secondary">
            ご不明な点は「お問い合わせ」からお送りください。<br />
            運営からのお知らせは引き続き確認できます。
          </p>
        </div>
        <div className="mt-4"><PlatformNotices /></div>
      </div>
      <Button href="/hq/support" variant="primary" className="w-full">
        お問い合わせへ
      </Button>
    </AuthCard>
  )
}
