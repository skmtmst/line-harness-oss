/**
 * イベント域のKPIの札（#740）。`events/page.tsx` の Kpi と
 * `events/bookings/page.tsx` の EventKpi は一字一句同じだったため1つに統合した。
 * 見た目を変えるときはここだけ直すこと。
 */
export default function EventKpi({
  title,
  value,
  unit,
  detail,
}: {
  title: string
  value: string
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{title}</p>
      <p className="text-ink mt-1 text-2xl font-semibold tabular-nums">
        {value}
        <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}
