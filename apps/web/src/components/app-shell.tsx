'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import SessionLostNotice from './session-lost-notice'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/login/two-factor') {
    return <>{children}</>
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
          <div className="flex flex-1 min-h-0">
            <Sidebar />
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
