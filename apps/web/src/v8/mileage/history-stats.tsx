import { CalendarRange, History, TrendingDown, TrendingUp } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { formatNumber } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'

type HistoryStatsProps = {
  title: string; ready: boolean; total: number | null; grantedCount: number; spendCount: number; reversalCount: number
  manualCount?: number | null; pendingCount?: number | null; grantAmount: number; spendAmount: number
}

export default function HistoryStats({ title, ready, total, grantedCount, spendCount, reversalCount, manualCount, pendingCount, grantAmount, spendAmount }: HistoryStatsProps) {
  return <KpiBand>
    <KpiCard presentation="band" title={title} icon={<History size={14} aria-hidden="true" />}
      value={ready ? total : null} unit="件"
      detail={<span title={`この条件で手で動かした分 ${manualCount == null ? '未取得' : `${formatNumber(manualCount)} 件`}・反映を待っている ${pendingCount == null ? '未取得' : `${formatNumber(pendingCount)} 件`}`}>
        {ready ? `付けた ${formatNumber(grantedCount)}・使った ${formatNumber(spendCount)}・取り消し ${formatNumber(reversalCount)}` : emptyValue('unknown')}
      </span>} />
    <KpiCard presentation="band" title="付けた" icon={<TrendingUp size={14} aria-hidden="true" />}
      value={ready ? grantAmount : null} unit="マイル" detail="" />
    <KpiCard presentation="band" title="使った" icon={<TrendingDown size={14} aria-hidden="true" />}
      value={ready ? Math.abs(spendAmount) : null} unit="マイル" detail={`交換 ${formatNumber(spendCount)} 件`} />
    <KpiCard presentation="band" title="取り消し" icon={<CalendarRange size={14} aria-hidden="true" />}
      value={ready ? reversalCount : null} unit="件" detail="注文の取り消しで引いた" />
  </KpiBand>
}
