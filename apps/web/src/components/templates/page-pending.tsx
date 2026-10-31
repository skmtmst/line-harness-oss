'use client'

import { createContext, useContext, type ReactNode } from 'react'
import ListState from '@/components/shared/list-state'
import { PageContent, PageFrame, PageHeading } from './page-frame'

type PendingVariant = 'detail' | 'dashboard'
const PendingLayout = createContext<PendingVariant>('detail')

/** 外枠が待機の型を渡す。認証や役割を待つ段階でも本文の位置をそろえる。 */
export function PagePendingLayout({ variant, children }: { variant: PendingVariant; children: ReactNode }) {
  return <PendingLayout.Provider value={variant}>{children}</PendingLayout.Provider>
}

export function usePagePendingVariant() { return useContext(PendingLayout) }

/** 画面をまだ出せない間の共通の骨組み。ホームは最初から本文と同じ見出しを置く。 */
export default function PagePending({ failed = false, onRetry, stage = 'identity', variant, error, errorTitle, description, retrying }: { failed?: boolean; onRetry?: () => void; stage?: 'auth' | 'identity' | 'route' | 'root' | 'store' | 'handover' | 'style'; variant?: PendingVariant; error?: unknown; errorTitle?: string; description?: string; retrying?: boolean }) {
  const inherited = usePagePendingVariant()
  const dashboard = (variant ?? inherited) === 'dashboard'
  return <PageFrame kind={dashboard ? 'dashboard' : 'detail'}>
    {dashboard ? <PageHeading title="ダッシュボード" /> : null}
    <PageContent layout={dashboard ? 'stats' : undefined} data-page-pending={stage}>
      <ListState kind={failed ? 'error' : 'loading'} loadingShape={dashboard ? 'cards' : undefined} title={failed ? errorTitle : undefined} error={error} description={description} onRetry={onRetry} retrying={retrying} />
    </PageContent>
  </PageFrame>
}
