'use client'

import AuthCard from '@/components/auth/auth-card'
import PlatformNotices from '@/components/hq/platform-notices'
import Button from '@/components/shared/button'

/** 契約先の利用停止案内。V6正本 `CXFjb9` が唯一の見た目の正本。 */
export default function TenantSuspended() {
  return (
    <AuthCard
      node="CXFjb9"
      cardNode="m3tWJ"
      title="現在ご利用いただけません"
      description="ご契約の利用が停止されています。"
    >
      <div className="w-full">
        <PlatformNotices />
        <div className="rounded-control bg-status-danger-soft px-4 py-4 text-left">
          <p className="text-label font-bold text-status-danger">管理画面の機能は一時停止しています</p>
          <p className="mt-1 text-caption text-ink-secondary">
            ご不明な点はお問い合わせ画面からお送りください。運営からのお知らせはこの画面で確認できます。
          </p>
        </div>
      </div>
      <Button href="/hq/support" variant="primary" className="w-full">
        お問い合わせへ
      </Button>
    </AuthCard>
  )
}
