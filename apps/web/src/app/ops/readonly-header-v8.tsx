'use client'

import type { ReactNode } from 'react'
import PageHeader from '@/components/shared/page-header'
import { useAdminTheme } from '@/lib/use-admin-theme'
import OpsPageHeader from '@/components/ops/ops-page-header'
import './readonly-v8.css'

export default function ReadonlyHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const theme = useAdminTheme()
  if (theme !== 'v8') return <OpsPageHeader title={title} actions={actions} />
  return <PageHeader breadcrumb={[]} title={title} description={description ?? ""} actions={actions} className="v8-ro-ops-header" />
}

/** V7の要素はそのまま残し、V8だけ板の印を外側に付ける。 */
export function ReadonlyDesignNode({ node, children }: { node: string; children: ReactNode }) {
  const theme = useAdminTheme()
  return theme === 'v8' ? <div className="contents" data-design-node={node}>{children}</div> : <>{children}</>
}
