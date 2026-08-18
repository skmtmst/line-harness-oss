import { useState } from 'react'
import Link from 'next/link'
import type { Scenario, DeliveryMode } from '@line-crm/shared'

type ScenarioRow = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}

/**
 * 配信方式。設計の一覧は「時刻」「日付」のように短く出す。
 * relative は 028 以前の作り方で、いまは新しく作れない。
 */
const deliveryModeLabels: Record<DeliveryMode, string> = {
  relative: '経過時間（旧）',
  elapsed: '経過時間',
  absolute_time: '時刻',
}

interface ScenarioListProps {
  scenarios: ScenarioRow[]
  onToggleActive: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  /** 掴んで並べ替えたときに、見えている順で呼ばれる。 */
  onReorder?: (ids: string[]) => void
  loading?: boolean
}

/**
 * シナリオの一覧。
 *
 * 設計（V2 4-1）は表。以前は札を3列に並べていたが、シナリオが増えると
 * 縦に伸びて、購読中の人数どうしを見比べられなかった。数を並べて読む
 * 画面なので、列で揃える。
 */
export default function ScenarioList({
  scenarios,
  onToggleActive,
  onDelete,
  onReorder,
  loading,
}: ScenarioListProps) {
  /** いま掴んでいるシナリオ。落とした先と入れ替える。 */
  const [dragId, setDragId] = useState<string | null>(null)

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !onReorder) return
    const order = scenarios.map((s) => s.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    onReorder(order)
  }

  if (scenarios.length === 0) {
    return (
      <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
        <p className="text-ink-faint text-sm">
          シナリオがありません。「＋ シナリオを作成」から作ってください。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-canvas-sunken border-hairline border-b">
              <th className="w-10 px-2 py-3" aria-label="並び替え" />
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                シナリオ名
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                配信方式
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                購読中
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                読了済
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                通数
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                状態
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-hairline divide-y">
            {scenarios.map((s) => (
              <tr key={s.id} className="hover:bg-canvas-sunken">
                {/* 掴んで上下に入れ替える。よく使うものを上に置くための操作。 */}
                <td
                  className="text-ink-faint w-10 cursor-grab px-2 py-3 text-center select-none active:cursor-grabbing"
                  draggable={Boolean(onReorder)}
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(s.id)}
                  aria-label={`${s.name} を並び替える`}
                  title="上下に動かして並び替え"
                >
                  ⠿
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/scenarios/detail?id=${s.id}`}
                    className="text-info text-sm font-medium hover:underline"
                  >
                    {s.name}
                  </Link>
                  {/* 全アカウント共通のものは、触ると他のアカウントにも効く。
                      名前の隣に出して、開く前に分かるようにする。 */}
                  {s.lineAccountId === null && (
                    <span
                      className="bg-warning-bg text-warning rounded-pill ml-2 px-2 py-0.5 text-[10px] font-medium"
                      title="全アカウントに適用されるシナリオです"
                    >
                      全アカウント共通
                    </span>
                  )}
                  {s.description && (
                    <p className="text-ink-faint mt-0.5 line-clamp-1 text-xs">{s.description}</p>
                  )}
                </td>
                <td className="text-ink-secondary px-4 py-3 text-sm">
                  {deliveryModeLabels[s.deliveryMode ?? 'relative']}
                </td>
                <td className="text-ink px-4 py-3 text-sm tabular-nums">
                  {(s.subscriberCount ?? 0).toLocaleString('ja-JP')}
                  <span className="text-ink-faint ml-0.5 text-xs">人</span>
                </td>
                <td className="text-ink px-4 py-3 text-sm tabular-nums">
                  {(s.completedCount ?? 0).toLocaleString('ja-JP')}
                  <span className="text-ink-faint ml-0.5 text-xs">人</span>
                </td>
                <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums">
                  {s.stepCount ?? '—'}
                  {s.stepCount !== undefined && (
                    <span className="text-ink-faint ml-0.5 text-xs">通</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                      s.isActive ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                    }`}
                  >
                    {s.isActive ? '配信可' : '停止中'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      // 全アカウント共通は、どのアカウントから触っても全部に効く。
                      // 別のアカウントを見ているつもりで止めてしまう事故を防ぐ。
                      if (
                        s.lineAccountId === null &&
                        !confirm(
                          `「${s.name}」は全アカウント共通のシナリオです。${s.isActive ? '停止' : '再開'}するとすべてのアカウントに影響します。続けますか？`,
                        )
                      ) {
                        return
                      }
                      onToggleActive(s.id, s.isActive)
                    }}
                    disabled={loading}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    {s.isActive ? '停止' : '再開'}
                  </button>
                  <Link
                    href={`/scenarios/detail?id=${s.id}`}
                    className="text-accent mx-1 px-2.5 py-1 text-xs font-medium hover:underline"
                  >
                    編集
                  </Link>
                  <button
                    onClick={() => {
                      const message =
                        s.lineAccountId === null
                          ? `「${s.name}」は全アカウント共通のシナリオです。削除するとすべてのアカウントから消えます。本当に削除しますか？`
                          : `「${s.name}」を削除してもよいですか？`
                      if (confirm(message)) onDelete(s.id)
                    }}
                    disabled={loading}
                    className="text-danger hover:bg-danger-bg rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
