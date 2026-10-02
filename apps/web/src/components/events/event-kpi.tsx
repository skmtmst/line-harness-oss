import HelpTip from '@/components/shared/help-tip'
import MetricValue from '@/components/ui/metric-value'

/**
 * イベント域のKPIの札（#740）。`events/page.tsx` の Kpi と
 * `events/bookings/page.tsx` の EventKpi は一字一句同じだったため1つに統合した。
 * 見た目を変えるときはここだけ直すこと。
 *
 * 監査6 #674: 数字の見せ方（tabular-nums・単位小・—/0/未取得の3状態）は
 * MetricValue に揃える。取れていない値は '—' の文字ではなく null を渡す。
 */
export default function EventKpi({
  title,
  value,
  unit,
  detail,
  help,
}: {
  title: string
  value: number | null
  unit: string
  detail: string
  /**
   * 数の数え方（分母・いつ時点か）の補足（共通ルール 2-1b）。
   * 本文に書くと札の高さがずれるため、見出し横の「？」へ入れる。
   */
  help?: { label: string; text: string }
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint flex items-center gap-1 text-xs">
        <span>{title}</span>
        {help && <HelpTip label={help.label}>{help.text}</HelpTip>}
      </p>
      <p className="text-ink mt-1 text-2xl font-semibold">
        <MetricValue value={value} unit={unit} />
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}
