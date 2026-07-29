'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import MobileQuickNav from './layout/mobile-quick-nav'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden">
          {/* Phase 6: banner above sidebar+header so it pins to the top of the
              admin shell. Renders nothing while loading; one of latest/fork/
              upgrade once /admin/version + manifest resolve. */}
          <UpdateBanner />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-y-auto overscroll-y-contain pt-[72px] lg:pt-0">
              <div className="px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-8 lg:pt-8">
                {children}
              </div>
            </main>
            <MobileQuickNav />
          </div>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
