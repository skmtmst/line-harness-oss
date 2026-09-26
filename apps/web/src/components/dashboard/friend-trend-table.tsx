import { useState } from 'react'
import type { DashboardOverview } from '@/lib/api'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

/**
 * 友だち数の推移。
 *
 * 設計（`card 友だち数の推移`）は表。折れ線ではない。
 * 日付・前日比・登録・ブロック・有効友だち・流入元の6列。
 *
 * 流入元は友だち追加日の経路名ごとに集計した実データを表示する。
 */

const ESTIMATED_NOTE =
  '「推定」の日は、日次の記録が始まる前のぶんです。いま残っている友だちから逆算しているので、退会した人は数に入っていません。記録は今日から溜まります。'

/**
 * 「推定」の説明。
 *
 * 以前はホバーでだけ開く absolute の吹き出しで、表のスクロール領域と
 * カードの overflow-hidden に挟まれて端の行・狭い幅で切れていた
 * （DASH-17）。押す・フォーカスしてEnterでその日の行内に本文を開く
 * 形にし、画面外へはみ出さない。Escで閉じる。
 */
function EstimatedHelp({
  open,
  onToggle,
  label,
}: {
  open: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          onToggle()
        }
      }}
      className="border-ink-faint text-ink-faint inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full border text-nano leading-none font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      ?
    </button>
  )
}

export default function FriendTrendTable({
  trend,
  loading,
}: {
  trend: DashboardOverview['trend']
  loading?: boolean
}) {
  /* 説明を開いている行。同時に1行だけにする。 */
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  /* 流入元の内訳を全文で開いている行。 */
  const [sourcesOpenFor, setSourcesOpenFor] = useState<string | null>(null)

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
  if (rows.length === 0) {
    return <p className="text-ink-faint px-5 py-6 text-center text-sm">この期間の推移はまだありません</p>
  }
  return (
    <div>
      {/*
        狭い幅では列が多い表をそのまま縮めると見出しが一文字ずつ縦に割れる
        （DASH-27）。見出しは折り返さず、横へ移動できることを案内する。
      */}
      <p className="text-ink-faint px-5 pt-2 text-micro sm:hidden">表は横にスクロールできます</p>
      <DataTable className="rounded-none border-0">
          <thead>
            <TableHeadRow>
              <Th style={{ width: '18%' }} className="whitespace-nowrap">日付</Th>
              <Th style={{ width: '12%' }} align="right" className="whitespace-nowrap">前日比</Th>
              <Th style={{ width: '12%' }} align="right" className="whitespace-nowrap">登録</Th>
              <Th style={{ width: '12%' }} align="right" className="whitespace-nowrap">ブロック</Th>
              <Th style={{ width: '14%' }} align="right" className="whitespace-nowrap">有効友だち</Th>
              <Th style={{ width: '32%' }} className="whitespace-nowrap">流入元の内訳</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // 前日比は、1つ後ろ（＝前日）との差。最終行は比べる相手がいない。
              const previous = rows[i + 1]
              const diff = previous ? row.active - previous.active : null
              const sources = formatTrendSources(row.sources)
              const noteOpen = noteOpenFor === row.date
              const sourcesOpen = sourcesOpenFor === row.date
              const canExpandSources = sources.full !== sources.compact
              return (
                <Tr key={row.date} className="text-ink-secondary">
                  <Td className="whitespace-nowrap">
                    {formatDate(row.date)}
                    {row.estimated && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-nano">
                        <span className="text-ink-faint">推定</span>
                        <EstimatedHelp
                          open={noteOpen}
                          onToggle={() => setNoteOpenFor(noteOpen ? null : row.date)}
                          label={`${formatDate(row.date)}の推定値について`}
                        />
                      </span>
                    )}
                    {row.estimated && noteOpen ? (
                      <span className="text-ink-faint mt-1 block max-w-64 text-micro leading-relaxed font-normal whitespace-normal">
                        {ESTIMATED_NOTE}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {diff === null ? '—' : diff === 0 ? '0' : diff > 0 ? `+${diff}` : diff}
                  </Td>
                  <Td align="right" className="tabular-nums">{row.added}</Td>
                  <Td align="right" className="tabular-nums">{row.blocked}</Td>
                  <Td align="right" className="font-medium tabular-nums">
                    {row.active.toLocaleString('ja-JP')}
                  </Td>
                  <Td className="text-ink-faint">
                    {canExpandSources ? (
                      /*
                        内訳が省略されているときは、指・キーボードで全文を開ける
                        ようにする（DASH-27）。ホバーの title だけに依存しない。
                      */
                      <button
                        type="button"
                        aria-expanded={sourcesOpen}
                        onClick={() => setSourcesOpenFor(sourcesOpen ? null : row.date)}
                        className="text-left hover:text-ink-secondary focus-visible:text-action focus-visible:underline"
                      >
                        <span className={sourcesOpen ? 'whitespace-normal' : 'block truncate'}>
                          {sourcesOpen ? sources.full : sources.compact}
                        </span>
                        <span className="text-action text-nano font-medium">
                          {sourcesOpen ? '閉じる' : 'すべて表示'}
                        </span>
                      </button>
                    ) : (
                      <span className="block truncate" title={sources.full}>{sources.compact}</span>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
      </DataTable>

    </div>
  )
}

export function formatTrendSources(
  sources: DashboardOverview['trend'][number]['sources'],
): { full: string; compact: string } {
  const values = sources ?? []
  /*
   * 経路不明の塊は name=null で来る。「経路不明」を経路名として出すと
   * 実在する経路と区別がつかないので `—` にする。内訳自体が無い日も
   * `—`（経路なし、ではなく「内訳なし」の置き方に揃える）。
   */
  const label = (source: { name: string | null; count: number }) =>
    `${source.name ?? '—'} ${source.count}`
  return {
    full: values.map(label).join('、'),
    compact: values.length
      ? values.slice(0, 2).map(label).join('、')
      : '—',
  }
}

/** 8月15日(土) の形にする。設計の表記に合わせている。 */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  // 壊れた日付は元の文字列をそのまま出す。「NaN月NaN日」にはしない。
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return iso
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${month}月${day}日(${weekday})`
}
