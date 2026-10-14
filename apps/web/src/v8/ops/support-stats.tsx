import { CircleMinus, CirclePlus, History } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import type { OpsSupportSummary } from '@/lib/api'

/** 期間別の件数を作らず、集計APIから取れる状態別の件数だけを表示する。 */
export default function OpsSupportStats({ summary, loading }: { summary: OpsSupportSummary | null; loading: boolean }) {
  return (
    <KpiBand edgeInset="parent">
      <KpiCard presentation="cell" title="新規" icon={<History size={14} aria-hidden="true" />} value={summary?.byStage.new} unit="件" detail="新しく受け付けた相談" loading={loading} />
      <KpiCard presentation="cell" title="対応中" icon={<CirclePlus size={14} aria-hidden="true" />} value={summary?.byStage.in_progress} unit="件" detail="運営が対応している相談" loading={loading} />
      <KpiCard presentation="cell" title="確認待ち" icon={<CircleMinus size={14} aria-hidden="true" />} value={summary?.byStage.waiting} unit="件" detail="契約先の返事待ち" loading={loading} />
    </KpiBand>
  )
}
