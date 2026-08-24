'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import SessionLostNotice from './session-lost-notice'
import RootLandingGate from './root-landing-gate'
import HqReturnButton from './hq-return-button'
import styles from './app-shell.module.css'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isFriendAttributesV2 = pathname === '/tags-v2' || pathname === '/visual-qa/friend-attributes-v2'
  const isFriendAttributesV3 = pathname === '/tags-v3' || pathname === '/visual-qa/friend-attributes-v3'

  if (pathname === '/login' || pathname === '/login/two-factor') {
    return <>{children}</>
  }

  // 参照画像との比較専用。開発中だけ表示し、実データの取得・保存は行わない。
  // 本番ビルドでは通常の認証ガードを必ず通る。
  if (process.env.NODE_ENV === 'development' && pathname.startsWith('/visual-qa/')) {
    return (
      <AccountProvider>
        <div className={`${styles.workspace} ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
          <Sidebar friendAttributesV2Mode={isFriendAttributesV2} preview={isFriendAttributesV2 || isFriendAttributesV3} />
          <main className={styles.main}>
            <div data-design-shell="v5-1920" data-design-node="J33xq" className={`${styles.content} ${isFriendAttributesV2 ? 'lg:pt-[32px]' : ''}`}>
              {children}
            </div>
          </main>
        </div>
      </AccountProvider>
    )
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className={styles.shell}>
          {/* Cookieが届いていないときの案内。全画面で同じものを1つだけ出す。 */}
          <SessionLostNotice />
          {/* Phase 6: banner above sidebar+header so it pins to the top of the
              admin shell. Renders nothing while loading; one of latest/fork/
              upgrade once /admin/version + manifest resolve. */}
          <UpdateBanner />
          <div className={`${styles.workspace} ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
            <Sidebar friendAttributesV2Mode={isFriendAttributesV2} />
            <main className={styles.main}>
              {/* V5正式共通メニュー J33xq と同じ256pxサイドバーを基準にする。 */}
              <div data-design-shell="v5-1920" data-design-node="J33xq" className={styles.content}>
                <HqReturnButton />
                <RootLandingGate>{children}</RootLandingGate>
              </div>
            </main>
          </div>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
