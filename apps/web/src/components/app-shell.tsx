'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import SessionLostNotice from './session-lost-notice'
import RootLandingGate from './root-landing-gate'
import StoreSelectionGate from './store-selection-gate'
import AppTopBar from './shell/app-top-bar'
import { PageChromeProvider, usePageChrome } from './shell/page-chrome'
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
            <div data-design-shell="v6-1920" data-design-node="J33xq" className={`${styles.content} ${isFriendAttributesV2 ? 'lg:pt-[32px]' : ''}`}>
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
        <PageChromeProvider>
          <div className={styles.shell}>
            {/* Cookieが届いていないときの案内。全画面で同じものを1つだけ出す。 */}
            <SessionLostNotice />
            {/* Phase 6: banner above sidebar+header so it pins to the top of the
                admin shell. Renders nothing while loading; one of latest/fork/
                upgrade once /admin/version + manifest resolve. */}
            <UpdateBanner />
            <div className={`${styles.workspace} ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
              <Sidebar friendAttributesV2Mode={isFriendAttributesV2} />
              <Workspace>
                <RootLandingGate><StoreSelectionGate>{children}</StoreSelectionGate></RootLandingGate>
              </Workspace>
            </div>
          </div>
        </PageChromeProvider>
      </AccountProvider>
    </AuthGuard>
  )
}

/**
 * 共通メニューの右側。上にトップバー、下に本文。
 *
 * `PageChromeProvider` の中でしか使えない（`usePageChrome` を読むため）。
 * 本文の幅は既定で `--container-shell` までにし、**ページが明示したときだけ**外す。
 * ルート名で自動判定しない（`docs/v6-common-rules.md` §1）。
 */
function Workspace({ children }: { children: React.ReactNode }) {
  const { fullWidth } = usePageChrome()
  return (
    <div className={styles.side}>
      <AppTopBar />
      <main className={styles.main}>
        {/* V6 共通メニュー J33xq と同じ256pxサイドバーを基準にする。 */}
        <div
          data-design-shell="v6-1920"
          data-design-node="J33xq"
          className={`${styles.content} ${fullWidth ? styles.contentFull : ''}`}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
