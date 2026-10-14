import { CircleCheck, Clock, LogOut, Play } from 'lucide-react'
import type { ScenarioStats } from '@line-crm/shared'
import type { ScenarioRuns } from '@/lib/api'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'

export default function ScenarioResultSummary({ stats, summary }: { stats: ScenarioStats; summary?: ScenarioRuns['summary'] }) {
  const completed = summary?.completed ?? stats.completed
  const inProgress = summary ? summary.active + summary.delivering + summary.paused : null
  return <KpiBand data-design="KPIs">
    <KpiCard icon={<Play size={14} aria-hidden="true" />} title="始まった" value={stats.enrolledTotal} unit="人"
      detail="購読を始めた人（重複なし）" help="再参加した人も1人として数えます。購読の件数とは数える範囲が異なります。" />
    <KpiCard presentation="cell" icon={<CircleCheck size={14} aria-hidden="true" />} title="読み終えた" value={completed}
      unit={summary ? '件' : '人'} detail={summary ? '完了した購読（再参加を含む）' : '完了した人（重複なし）'}
      help={summary ? '完了した購読の記録数です。同じ人が再参加すると複数件になります。始まった人数を分母にした割合は出しません。' : '完了の記録がある人を重複なく数えています。再参加中の人も含むため、途中の人数とは足し引きできません。'} />
    <KpiCard icon={<Clock size={14} aria-hidden="true" />} title="途中" value={inProgress} unit="件"
      detail="途中の購読（再参加を含む）" help="途中・送信中・止まっている購読の記録数です。購読の集計を読み込めないときは—を出します。" />
    <KpiCard presentation="cell" icon={<LogOut size={14} aria-hidden="true" />} title="離れた" value={null} unit="人"
      detail="離脱人数の集計は未接続" help="人数と購読件数は数える範囲が異なるため、始まった人数から完了・途中の件数を引いて離脱人数にはできません。離脱人数の集計はまだ提供されていません。" />
  </KpiBand>
}
