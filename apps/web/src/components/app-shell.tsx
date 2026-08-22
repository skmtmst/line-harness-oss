'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import SessionLostNotice from './session-lost-notice'

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
        <div className={`flex min-h-screen ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
          <Sidebar friendAttributesV2Mode={isFriendAttributesV2} preview={isFriendAttributesV2 || isFriendAttributesV3} />
          <main className="bg-shell min-w-0 flex-1 overflow-auto">
            <div data-design-shell="v4-1920" className={`mx-auto w-full max-w-shell px-4 pb-6 sm:px-6 lg:px-10 lg:pb-10 ${isFriendAttributesV2 ? 'lg:pt-[32px]' : 'lg:pt-8'}`}>
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
        <div className="flex min-h-screen flex-col">
          {/* Cookieが届いていないときの案内。全画面で同じものを1つだけ出す。 */}
          <SessionLostNotice />
          {/* Phase 6: banner above sidebar+header so it pins to the top of the
              admin shell. Renders nothing while loading; one of latest/fork/
              upgrade once /admin/version + manifest resolve. */}
          <UpdateBanner />
          <div className={`flex flex-1 min-h-0 ${isFriendAttributesV2 ? 'friend-attributes-v2-shell' : ''}`}>
            <Sidebar friendAttributesV2Mode={isFriendAttributesV2} />
            {/*
              上の余白は、狭い幅で画面の上に固定されるヘッダーのぶん。
              ヘッダーが消える境目（md）と余白を外す境目がずれていて、
              768〜1024px では誰も居ない場所に72pxの空白が残っていた。
            */}
            <main className="bg-shell flex-1 overflow-auto pt-[72px] md:pt-0">
              {/*
                Pen.dev V4 の共通レイアウト。1920pxでは、サイドバー256pxを
                引いた1664pxを本体に使い、左右40pxの余白を取る。

                以前はV2由来の左右32pxが残り、V4を実装しても各画面が設計より
                16px広くなっていた。今後の画面もV4へ移すため、ページ個別では
                なく共通レイアウトを正した。
              */}
              <div data-design-shell="v4-1920" className="mx-auto w-full max-w-shell px-4 pb-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
                {children}
              </div>
            </main>
          </div>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
