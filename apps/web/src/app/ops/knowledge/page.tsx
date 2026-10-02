'use client'

import OpsPageHeader from '@/app/ops/readonly-header-v8'
import ro from '@/app/ops/readonly-v8.module.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import KnowledgeList from '@/components/ops/knowledge-list'

export default function OpsKnowledgePage() {
  const theme = useAdminTheme()
  return (
    <div className={`${ro.page} ${ro.knowledge} flex flex-col gap-4`} data-design-node={theme === 'v8' ? 'h114s' : undefined}>
      {/* 見出しと一覧の縦の間隔はこの親の gap-4（16px）で作る。 */}
      <OpsPageHeader title="ナレッジ" />
      <KnowledgeList />
    </div>
  )
}
