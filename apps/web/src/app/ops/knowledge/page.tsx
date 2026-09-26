import OpsPageHeader from '@/components/ops/ops-page-header'
import KnowledgeList from '@/components/ops/knowledge-list'

export default function OpsKnowledgePage() {
  return (
    <div className="flex flex-col gap-4">
      {/* 見出しと一覧の縦の間隔はこの親の gap-4（16px）で作る。 */}
      <OpsPageHeader title="ナレッジ" />
      <KnowledgeList />
    </div>
  )
}
