import HelpTip from '@/components/shared/help-tip'
import type { DashboardOverview } from '@/lib/api'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

/**
 * 友だち数の推移。
 *
 * 設計（`card 友だち数の推移`）は表。折れ線ではない。
 * 日付・前日比・登録・ブロック・有効友だちの5列。
 *
 * 流入元の内訳は列に置かない（2026-09-27 オーナー指摘）。
 * 「さらに詳しく →」の先（アクセス解析の「友だちの増減」）で見る。
 * 列が減ったぶんの幅は、数字の列が吸う。
 */

const ESTIMATED_NOTE =
  '「推定」の日は、日次の記録が始まる前のぶんです。いま残っている友だちから逆算しているので、退会した人は数に入っていません。記録は今日から溜まります。'

const ALL_ESTIMATED_NOTE =
  'この表の日はすべて推定です。日次の記録が始まる前のぶんで、いま残っている友だちから逆算しているので、退会した人は数に入っていません。記録は今日から溜まります。'

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
          <div key={i} className="bg-canvas-sunken h-8 animate-pulse rounded-mini" />
        ))}
      </div>
    )
  }

  // 新しい日から見せる。設計も 8月15日 が先頭。
  const rows = [...trend].reverse()
  if (rows.length === 0) {
    return <p className="text-ink-faint px-5 py-6 text-center text-sm">この期間の推移はまだありません</p>
  }
  /*
   * 「推定」の「？」は7行に繰り返さず、見出しの日付の横に1つだけ置く
   * （★V7・2026-09-27）。行には小さく「推定」の文字だけ残す。
   * 全行が推定のときは、行からは消して見出しの「？」の中で言う。
   */
  const allEstimated = rows.every((row) => row.estimated)
  return (
    <div>
      <DataTable className="rounded-none border-0">
          <thead>
            <TableHeadRow>
              <Th style={{ width: '22%' }} className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  日付
                  <HelpTip label="日付の推定値の説明">
                    {allEstimated ? ALL_ESTIMATED_NOTE : ESTIMATED_NOTE}
                  </HelpTip>
                </span>
              </Th>
              <Th style={{ width: '14%' }} align="right" className="whitespace-nowrap">前日比</Th>
              <Th style={{ width: '16%' }} align="right" className="whitespace-nowrap">登録</Th>
              <Th style={{ width: '16%' }} align="right" className="whitespace-nowrap">ブロック</Th>
              <Th style={{ width: '32%' }} align="right" className="whitespace-nowrap">有効友だち</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // 前日比は、1つ後ろ（＝前日）との差。最終行は比べる相手がいない。
              const previous = rows[i + 1]
              const diff = previous ? row.active - previous.active : null
              return (
                <Tr key={row.date} className="text-ink-secondary">
                  <Td className="whitespace-nowrap">
                    <span>
                      {formatDate(row.date)}
                      {row.estimated && !allEstimated ? (
                        <span className="text-ink-faint ml-1.5 text-nano">推定</span>
                      ) : null}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    <span>{diff === null ? '—' : diff === 0 ? '0' : diff > 0 ? `+${diff}` : diff}</span>
                  </Td>
                  <Td align="right" className="tabular-nums"><span>{row.added}</span></Td>
                  <Td align="right" className="tabular-nums"><span>{row.blocked}</span></Td>
                  <Td align="right" className="font-medium tabular-nums">
                    <span>{row.active.toLocaleString('ja-JP')}</span>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
      </DataTable>

    </div>
  )
}

/** 8月15日(土) の形にする。設計の表記に合わせている。 */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  // 壊れた日付は元の文字列をそのまま出す。「NaN月NaN日」にはしない。
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return iso
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${month}月${day}日(${weekday})`
}
