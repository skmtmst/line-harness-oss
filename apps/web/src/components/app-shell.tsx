'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import SessionLostNotice from './session-lost-notice'
import RootLandingGate from './root-landing-gate'
import StoreSelectionGate from './store-selection-gate'
import FeatureDisabledGate from './feature-disabled-gate'
import AppTopBar from './shell/app-top-bar'
import { PageChromeProvider, usePageChrome } from './shell/page-chrome'
import styles from './app-shell.module.css'
import { isPublicAuthPath } from '@/lib/auth-email'
import OpsShell from './ops/ops-shell'
import ImpersonationNotice from './ops/impersonation-notice'
import SuspendedSidebar from './layout/suspended-sidebar'
import TopBar from './shared/top-bar'
import NoteBar from './shared/note-bar'
import PlatformNotices from './hq/platform-notices'
import { logoutAndGoToLogin } from '@/lib/logout'
import { useEffect, useState } from 'react'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isFriendAttributesV2 = pathname === '/visual-qa/friend-attributes-v2'
  const isFriendAttributesV3 = pathname === '/visual-qa/friend-attributes-v3'
  const isAccountCreate = pathname === '/accounts/new'

  if (isPublicAuthPath(pathname)) {
    return <>{children}</>
  }

  // 2要素認証の設定（★V6 37-10-B）は、まだ運営メンバーでない人も開く。外枠を付けない。
  if (pathname === '/ops/two-factor') {
    return <>{children}</>
  }

  // 運営コンソール（★V6 37）。統括・店舗の共通メニューとは別の外枠を使う。
  if (pathname === '/ops' || pathname.startsWith('/ops/')) {
    return <OpsShell>{children}</OpsShell>
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

  const guardedContent = <RootLandingGate><StoreSelectionGate><FeatureDisabledGate>{children}</FeatureDisabledGate></StoreSelectionGate></RootLandingGate>

  const suspendedSupport = (
    <PageChromeProvider>
      <SuspendedSupportWorkspace>{children}</SuspendedSupportWorkspace>
    </PageChromeProvider>
  )

  return (
    <AuthGuard suspendedSupport={suspendedSupport}>
      <AccountProvider>
        <PageChromeProvider>
          {isAccountCreate ? (
            <AccountCreateWorkspace>{guardedContent}</AccountCreateWorkspace>
          ) : (
            <div className={styles.shell}>
              {/*
                本文へ移動（★V7 修正方針 §2）。ふだんは見えず、Tab で最初に焦点が来たときだけ
                左上に出る。更新案内とメニュー11項目を飛ばして本文へ行ける（WCAG 2.4.1）。
              */}
              <a href="#main-content" className={styles.skipLink}>本文へ移動</a>
              {/* Cookieが届いていないときの案内。全画面で同じものを1つだけ出す。 */}
              <SessionLostNotice />
              {/* Phase 6: banner above sidebar+header so it pins to the top of the
                  admin shell. Renders nothing while loading; one of latest/fork/
                  upgrade once /admin/version + manifest resolve. */}
              <UpdateBanner />
              {/* 代理ログイン中の赤い帯（★V6 37-5）。運営マスター以外には出ない。 */}
              <ImpersonationNotice />
              <div className={`${styles.workspace} ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
                <Sidebar friendAttributesV2Mode={isFriendAttributesV2} />
                <Workspace>
                  {guardedContent}
                </Workspace>
              </div>
            </div>
          )}
        </PageChromeProvider>
      </AccountProvider>
    </AuthGuard>
  )
}

/** 停止中のお問い合わせ。V6 `IwfA0` の外枠だけを組み、通常の画面機能は再利用する。 */
function SuspendedSupportWorkspace({ children }: { children: React.ReactNode }) {
  const { title } = usePageChrome()
  const [staffName, setStaffName] = useState('')

  useEffect(() => {
    try { setStaffName(localStorage.getItem('lh_staff_name') ?? '') } catch { /* storage なし */ }
  }, [])

  return (
    <div className={styles.shell} data-design-node="IwfA0">
      <SessionLostNotice />
      <div className={styles.workspace}>
        <SuspendedSidebar />
        <div className={styles.side}>
          <div className="hidden xl:block">
            <TopBar
              title={title ?? 'お問い合わせ'}
              manualHref={null}
              accounts={[]}
              selectedAccountId=""
              onAccountChange={() => undefined}
              showAccountSwitcher={false}
              roleLabel="統括"
              userName={staffName}
              onLogout={logoutAndGoToLogin}
            />
          </div>
          <main id="main-content" tabIndex={-1} className={styles.main}>
            <div className={`${styles.content} ${styles.contentFull} flex min-h-full flex-col`}>
              <div className="flex min-h-full flex-1 flex-col gap-4">
                <div data-design-node="MdTiR">
                  <NoteBar tone="danger">
                    ご契約の利用が停止されています。この画面の「お問い合わせ」と、運営からのお知らせだけご利用いただけます。他の機能は復帰後に使えるようになります。
                  </NoteBar>
                </div>
                <PlatformNotices />
                {children}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

/** `/accounts/new` 専用。認証とアカウント文脈を保ち、通常のナビゲーションだけを外す。 */
function AccountCreateWorkspace({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell} data-account-create-shell="true">
      <SessionLostNotice />
      <UpdateBanner />
      <main className={styles.main}>
        <div
          data-design-shell="account-create"
          className={`${styles.content} ${styles.contentFull}`}
        >
          {children}
        </div>
      </main>
    </div>
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
      <main id="main-content" tabIndex={-1} className={styles.main}>
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
