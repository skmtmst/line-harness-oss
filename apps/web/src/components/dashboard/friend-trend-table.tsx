import type { DashboardOverview } from '@/lib/api'

/**
 * 友だち数の推移。
 *
 * 設計（`card 友だち数の推移`）は表。折れ線ではない。
 * 日付・前日比・登録・ブロック・有効友だち・流入元の6列。
 *
 * 流入元の内訳は、それを返すAPIがまだ無いので「—」を出す。
 * 適当な値を入れると、見た人が実データだと思ってしまう。
 */
export default function FriendTrendTable({
  trend,
  loading,
}: {
  trend: DashboardOverview['trend']
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-canvas-sunken h-8 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  // 新しい日から見せる。設計も 8月15日 が先頭。
  const rows = [...trend].reverse()
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-normal">
          <thead>
            <tr className="text-ink-faint border-hairline border-b text-left text-xs">
              <th className="px-5 py-2 font-medium">日付</th>
              <th className="px-3 py-2 text-right font-medium">前日比</th>
              <th className="px-3 py-2 text-right font-medium">登録</th>
              <th className="px-3 py-2 text-right font-medium">ブロック</th>
              <th className="px-3 py-2 text-right font-medium">有効友だち</th>
              <th className="px-5 py-2 font-medium">流入元の内訳</th>
            </tr>
          </thead>
          <tbody className="divide-hairline divide-y">
            {rows.map((row, i) => {
              // 前日比は、1つ後ろ（＝前日）との差。最終行は比べる相手がいない。
              const previous = rows[i + 1]
              const diff = previous ? row.active - previous.active : null
              return (
                <tr key={row.date} className="text-ink-secondary">
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {formatDate(row.date)}
                    {row.estimated && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-[10px]">
                        <span className="text-ink-faint">推定</span>
                        <span className="group relative inline-flex">
                          <button
                            type="button"
                            aria-label={`${formatDate(row.date)}の推定値について`}
                            className="border-ink-faint text-ink-faint focus-visible:border-action focus-visible:text-action inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border text-[9px] leading-none font-semibold outline-none"
                          >
                            ?
                          </button>
                          <span
                            role="tooltip"
                            className="bg-ink text-on-accent pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-72 -translate-x-1/2 rounded-control px-3 py-2 text-left text-xs leading-relaxed whitespace-normal shadow-lg group-hover:block group-focus-within:block"
                          >
                            「推定」の日は、日次の記録が始まる前のぶんです。いま残っている友だちから逆算しているので、退会した人は数に入っていません。記録は今日から溜まります。
                          </span>
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {diff === null ? '—' : diff === 0 ? '0' : diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.added}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.blocked}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {row.active.toLocaleString('ja-JP')}
                  </td>
                  {/* 流入元ごとの内訳を返すAPIがまだ無い。埋めるとしたら
                      entry_routes と friends の紐づけを日次で数える必要がある。 */}
                  <td className="text-ink-faint px-5 py-2.5">—</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

    </div>
  )
}

/** 8月15日(土) の形にする。設計の表記に合わせている。 */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00+09:00`)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekday})`
}
