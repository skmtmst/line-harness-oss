'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FriendField } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import KpiCard from '@/components/dashboard/kpi-card'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'

const TABS = [
  { key: 'messages', label: '送信数' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'cross', label: 'クロス集計' },
  { key: 'clicks', label: 'URLクリック' },
  { key: 'search', label: '検索からの流入' },
]

/** 期間の選択肢。日数で持つ。 */
const RANGES = [
  { days: 7, label: '7日' },
  { days: 28, label: '28日' },
  { days: 90, label: '90日' },
]

function rangeFor(days: number): { from: string; to: string } {
  const jstNow = new Date(Date.now() + 9 * 3600_000)
  return {
    from: new Date(jstNow.getTime() - days * 24 * 3600_000).toISOString().slice(0, 10),
    to: jstNow.toISOString().slice(0, 10),
  }
}

function RangePicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="mb-4 flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => onChange(r.days)}
          className={`rounded-pill px-3 py-1 text-sm transition-colors ${
            days === r.days
              ? 'bg-accent text-on-accent'
              : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 棒グラフ。
 *
 * ライブラリを入れず、divの高さで描く。目盛りが要るほど細かく見るなら
 * 数字の表を見た方が速い、という判断。書き出したページも軽く済む。
 */
function Bars({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-[1.5rem] flex-1 flex-col items-center gap-1">
          <div
            className="bg-accent w-full rounded-t"
            style={{ height: `${Math.round((item.value / max) * 100)}%` }}
            title={`${item.label}: ${item.value}`}
          />
          <span className="text-ink-faint text-[10px] whitespace-nowrap">
            {item.label.slice(5)}
          </span>
        </div>
      ))}
    </div>
  )
}

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土']

/** 「2026-08-12」→「水」。JST の日付文字列をそのまま曜日にする。 */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAY_JP[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function MessagesTab() {
  const [days, setDays] = useState(28)
  const [rows, setRows] = useState<
    Array<{
      date: string
      outgoing: number
      incoming: number
      reply: number
      push: number
      fromBroadcast: number
      fromScenario: number
    }>
  >([])
  const [broadcasts, setBroadcasts] = useState<
    Array<{
      broadcastId: string
      name: string
      sentAt: string | null
      delivered: number | null
      uniqueImpression: number | null
      uniqueClick: number | null
      suppressedByAudienceSize: boolean
    }>
  >([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const range = rangeFor(days)
    try {
      const [msg, bc] = await Promise.all([
        api.analytics.messages(range),
        api.analytics.broadcasts(range),
      ])
      if (msg.success) setRows(msg.data)
      if (bc.success) setBroadcasts(bc.data)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          outgoing: acc.outgoing + r.outgoing,
          incoming: acc.incoming + r.incoming,
          reply: acc.reply + r.reply,
          push: acc.push + r.push,
        }),
        { outgoing: 0, incoming: 0, reply: 0, push: 0 },
      ),
    [rows],
  )

  // 開封・クリックは配信ごとにしか返らない。日ごとの表に出すため、送った日で
  // まとめ直す。同じ日に複数の配信があれば足す。
  const byDate = useMemo(() => {
    const m = new Map<string, { delivered: number; impression: number; click: number }>()
    for (const b of broadcasts) {
      if (!b.sentAt) continue
      const date = b.sentAt.slice(0, 10)
      const cur = m.get(date) ?? { delivered: 0, impression: 0, click: 0 }
      m.set(date, {
        delivered: cur.delivered + (b.delivered ?? 0),
        impression: cur.impression + (b.uniqueImpression ?? 0),
        click: cur.click + (b.uniqueClick ?? 0),
      })
    }
    return m
  }, [broadcasts])

  const rates = useMemo(() => {
    const delivered = broadcasts.reduce((sum, b) => sum + (b.delivered ?? 0), 0)
    if (delivered === 0) return { open: null as number | null, click: null as number | null }
    const impression = broadcasts.reduce((sum, b) => sum + (b.uniqueImpression ?? 0), 0)
    const click = broadcasts.reduce((sum, b) => sum + (b.uniqueClick ?? 0), 0)
    return {
      open: Math.round((impression / delivered) * 100),
      click: Math.round((click / delivered) * 100),
    }
  }, [broadcasts])

  // 設計は新しい日が上。API は古い順に返す。
  const shown = useMemo(() => [...rows].reverse(), [rows])

  return (
    <div>
      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="今月の送信"
          value={totals.outgoing}
          unit="通"
          detail={`リプライ${totals.reply} ・ プッシュ${totals.push}`}
          loading={loading}
        />
        {/* 月の上限を持つ設定が無い。数字を置くと、実際の契約と食い違ったまま
            «あと何通送れるか» を読まれてしまう。 */}
        <KpiCard title="残枠" value={null} unit="通" detail="上限が未設定です" />
        <KpiCard
          title="平均開封率"
          value={rates.open}
          unit="%"
          detail="配信のうち"
          loading={loading}
        />
        <KpiCard
          title="平均クリック率"
          value={rates.click}
          unit="%"
          detail="短縮URL経由"
          loading={loading}
        />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="date"
          disabled
          title="日付での絞り込みは準備中です"
          aria-label="日付で絞り込み"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select
          disabled
          title="並び替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>日付が新しい順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">期間</span>
        <RangePicker days={days} onChange={setDays} />
        <button
          disabled
          title="書き出しは準備中です"
          className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
        >
          CSVで書き出す
        </button>
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">日付</th>
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">曜日</th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">リプライ数</th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">プッシュ数</th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">合計</th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">開封</th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">クリック</th>
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">備考</th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-ink-faint px-4 py-8 text-center text-sm">
                      この期間の記録はありません。
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => {
                    const b = byDate.get(r.date)
                    const notes: string[] = []
                    if (r.fromBroadcast > 0) notes.push('一斉配信')
                    if (r.fromScenario > 0) notes.push('シナリオ')
                    return (
                      <tr key={r.date} className="hover:bg-canvas-sunken">
                        <td className="text-ink px-4 py-3 text-sm tabular-nums">{r.date}</td>
                        <td className="text-ink-secondary px-4 py-3 text-sm">{weekdayOf(r.date)}</td>
                        <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                          {r.reply}
                        </td>
                        <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                          {r.push}
                        </td>
                        <td className="text-ink px-4 py-3 text-right text-sm font-medium tabular-nums">
                          {r.outgoing}
                        </td>
                        {/* 配信が無い日は開封もクリックも取りようがない。0 と
                            書くと「送ったのに誰も読んでいない」に見える。 */}
                        <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                          {b && b.delivered > 0
                            ? `${b.impression}（${Math.round((b.impression / b.delivered) * 1000) / 10}%）`
                            : '—'}
                        </td>
                        <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                          {b && b.delivered > 0 ? b.click : '—'}
                        </td>
                        <td className="text-ink-faint px-4 py-3 text-sm">
                          {notes.length > 0 ? notes.join(' ・ ') : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink-faint text-xs tabular-nums">
              合計 リプライ {totals.reply} ・ プッシュ {totals.push} ・ {totals.outgoing} 通
            </p>
            <div className="flex items-center gap-2 text-xs">
              <button
                disabled
                title="ページの切り替えは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-2 py-1 opacity-50"
              >
                前へ
              </button>
              <button
                disabled
                title="ページの切り替えは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-2 py-1 opacity-50"
              >
                次へ
              </button>
            </div>
          </div>

          <p className="text-ink-faint mt-3 text-xs leading-relaxed">
            この集計は当システムが独自に数えたものです。LINEヤフー社から実際に課金される正確な送信数は
            LINE Developers でご確認ください。
          </p>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            リプライとプッシュを足しても合計に届かないことがあります。区分を記録する前に
            送ったぶんと、テスト送信がどちらにも入らないためです。
          </p>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            配信先が20人未満のときは、LINEから開封数・クリック数が返りません（「—」と表示します）。
            0件という意味ではありません。
          </p>
        </>
      )}
    </div>
  )
}

function ClicksTab() {
  const [days, setDays] = useState(28)
  const [rows, setRows] = useState<
    Array<{ trackedLinkId: string; name: string; clicks: number; uniqueFriends: number }>
  >([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void api.analytics
      .linkClicks(rangeFor(days))
      .then((res) => {
        if (res.success) setRows(res.data)
      })
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div>
      <RangePicker days={days} onChange={setDays} />
      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-canvas-sunken border-hairline border-b">
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                リンク
              </th>
              <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                クリック
              </th>
              <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                踏んだ人
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                  読み込み中...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                  この期間のクリックはありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.trackedLinkId} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm">{r.name}</td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {r.clicks.toLocaleString('ja-JP')}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {r.uniqueFriends.toLocaleString('ja-JP')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-ink-faint mt-3 text-xs">
        LINEの外から踏まれたクリックは、誰が踏んだか分かりません。
        「クリック」には数えますが「踏んだ人」には入りません。
      </p>
    </div>
  )
}

function CrossTab() {
  const [fields, setFields] = useState<FriendField[]>([])
  const [fieldId, setFieldId] = useState('')
  const [cells, setCells] = useState<Array<{ row: string; col: string; count: number }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void api.friendFields.list().then((res) => {
      if (res.success) {
        setFields(res.data)
        if (res.data.length > 0) setFieldId(res.data[0].id)
      }
    })
  }, [])

  useEffect(() => {
    if (!fieldId) return
    setLoading(true)
    void api.analytics
      .cross(fieldId)
      .then((res) => {
        if (res.success) setCells(res.data)
      })
      .finally(() => setLoading(false))
  }, [fieldId])

  const rows = useMemo(() => [...new Set(cells.map((c) => c.row))], [cells])
  const cols = useMemo(() => [...new Set(cells.map((c) => c.col))], [cells])
  const lookup = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of cells) map.set(`${c.row} ${c.col}`, c.count)
    return map
  }, [cells])

  if (fields.length === 0) {
    return (
      <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
        友だち情報欄の項目がまだありません。
        <Link href="/tags/fields/new" className="text-accent ml-1 hover:underline">
          項目を追加
        </Link>
      </p>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <label htmlFor="cross-field" className="text-ink-secondary mb-1 block text-sm font-medium">
          タグ × この項目の値
        </label>
        <select
          id="cross-field"
          value={fieldId}
          onChange={(e) => setFieldId(e.target.value)}
          className="border-hairline rounded-control border px-3 py-2 text-sm"
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : cells.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          この項目に値が入っている人がいません。
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  タグ
                </th>
                {cols.map((col) => (
                  <th
                    key={col}
                    className="text-ink-faint px-4 py-3 text-right text-xs font-semibold"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">{row}</td>
                  {cols.map((col) => {
                    const n = lookup.get(`${row} ${col}`) ?? 0
                    return (
                      <td
                        key={col}
                        className={`px-4 py-3 text-right text-sm tabular-nums ${
                          n === 0 ? 'text-ink-faint' : 'text-ink-secondary'
                        }`}
                      >
                        {n === 0 ? '—' : n.toLocaleString('ja-JP')}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-ink-faint mt-3 text-xs">
        値が入っている人だけを数えます。空欄の人は表に出ません。
      </p>
    </div>
  )
}

function FunnelTab() {
  const [funnels, setFunnels] = useState<
    Array<{ id: string; name: string; windowDays: number; createdAt: string }>
  >([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<Array<{
    stepOrder: number
    label: string
    reached: number
    conversionFromPrevious: number
  }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void api.funnels
      .list()
      .then((res) => {
        if (res.success) {
          setFunnels(res.data)
          if (res.data.length > 0) setSelected(res.data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selected) return
    void api.funnels.result(selected).then((res) => {
      if (res.success) setResult(res.data.steps)
    })
  }, [selected])

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  const top = result?.[0]?.reached ?? 0

  return (
    <div>
      {creating ? (
        <FunnelForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void api.funnels.list().then((res) => {
              if (res.success) setFunnels(res.data)
            })
            setSelected(id)
          }}
        />
      ) : (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setCreating(true)}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
          >
            ＋ ファネルを作成
          </button>
        </div>
      )}

      {funnels.length === 0 && !creating ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          ファネルがまだありません。段を2つ以上つないで、どこで離れているかを見られます。
        </p>
      ) : funnels.length === 0 ? null : (
      <>
      <div className="mb-4">
        <label htmlFor="funnel-select" className="text-ink-secondary mb-1 block text-sm font-medium">
          ファネル
        </label>
        <select
          id="funnel-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="border-hairline rounded-control border px-3 py-2 text-sm"
        >
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {result && (
        <div className="bg-canvas rounded-card border-hairline space-y-3 border p-5">
          {result.map((step, i) => (
            <div key={step.stepOrder}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="text-ink text-sm font-medium">
                  {i + 1}. {step.label}
                </p>
                <p className="text-ink-secondary text-sm tabular-nums">
                  {step.reached.toLocaleString('ja-JP')} 人
                  {i > 0 && (
                    <span className="text-ink-faint ml-2 text-xs">
                      前の段から {Math.round(step.conversionFromPrevious * 100)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="bg-canvas-sunken h-6 overflow-hidden rounded">
                <div
                  className="bg-accent h-full"
                  style={{ width: top > 0 ? `${(step.reached / top) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}

/**
 * ファネルの作成。
 *
 * 段は上から順に「次に進んだ人」を数える。作るときも上から並べる順で
 * 入れてもらう。番号を振らせると、抜けや重複を毎回確かめることになる。
 */
function FunnelForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const KINDS = [
    { key: 'tag', label: 'タグが付いた', hint: 'タグのID' },
    { key: 'field', label: '情報欄に値が入った', hint: '項目のID' },
    { key: 'form', label: 'フォームに答えた', hint: 'フォームのID' },
    { key: 'site_event', label: 'サイトのページを見た', hint: 'パス（例: /thanks）' },
    { key: 'link_click', label: 'リンクを踏んだ', hint: '計測リンクのID' },
    { key: 'conversion', label: '成果が記録された', hint: '成果地点のID' },
  ]

  const [name, setName] = useState('')
  const [steps, setSteps] = useState([
    { label: '', kind: 'tag', value: '' },
    { label: '', kind: 'conversion', value: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matchFor = (kind: string, value: string): Record<string, string> => {
    if (kind === 'tag') return { tagId: value }
    if (kind === 'field') return { fieldId: value }
    if (kind === 'form') return { formId: value }
    if (kind === 'site_event') return { eventType: 'page_view', path: value }
    if (kind === 'link_click') return { trackedLinkId: value }
    return { conversionPointId: value }
  }

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (steps.some((s) => !s.label.trim())) {
      setError('すべての段に名前を付けてください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.funnels.create({
        name: name.trim(),
        steps: steps.map((s) => ({
          label: s.label.trim(),
          kind: s.kind,
          match: matchFor(s.kind, s.value.trim()),
        })),
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      onCreated(res.data.id)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-canvas rounded-card border-hairline mb-5 space-y-4 border p-5">
      <div>
        <label htmlFor="fn-name" className="text-ink-secondary mb-1 block text-sm font-medium">
          名前
        </label>
        <input
          id="fn-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 友だち追加から購入まで"
          className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="text-ink-secondary text-sm font-medium">段（上から順に見ます）</p>
        {steps.map((step, i) => (
          <div key={i} className="border-hairline flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <span className="text-ink-faint pb-2 text-sm tabular-nums">{i + 1}.</span>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">段の名前</label>
              <input
                type="text"
                value={step.label}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, label: e.target.value } : s)),
                  )
                }
                placeholder="例: 友だち追加"
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-ink-faint mb-1 block text-xs">何をしたら</label>
              <select
                value={step.kind}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, kind: e.target.value } : s)),
                  )
                }
                className="border-hairline rounded-control border px-2 py-1.5 text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">
                {KINDS.find((k) => k.key === step.kind)?.hint}
              </label>
              <input
                type="text"
                value={step.value}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, value: e.target.value } : s)),
                  )
                }
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm"
              />
            </div>
            {steps.length > 2 && (
              <button
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                className="text-danger hover:bg-danger-bg rounded px-2 py-1.5 text-xs"
              >
                外す
              </button>
            )}
          </div>
        ))}
        {steps.length < 10 && (
          <button
            onClick={() => setSteps((prev) => [...prev, { label: '', kind: 'tag', value: '' }])}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-sm"
          >
            ＋ 段を足す
          </button>
        )}
      </div>

      <p className="text-ink-faint text-xs">
        段は2つ以上10個まで。1段だけだと「ただの件数」になり、どこで離れたかが分かりません。
      </p>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {saving ? '保存中...' : '作成'}
        </button>
        <button
          onClick={onCancel}
          className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}

function AnalyticsInner() {
  const tab = useMergedTab(TABS)
  return (
    <div>
      <div data-design="Head">
        <Header
          title="分析"
          description="配信した数と、その反応をまとめて見ます。送信数はLINEの課金対象と直結するため、残枠と合わせて確認してください。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              <button
                disabled
                title="レポートの保存は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                レポートを保存
              </button>
              <button
                disabled
                title="書き出しは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                CSVで書き出す
              </button>
            </div>
          }
        />
      </div>
      <MergedTabs basePath="/analytics" tabs={TABS} active={tab} />
      {tab === 'messages' && <MessagesTab />}
      {tab === 'clicks' && <ClicksTab />}
      {tab === 'cross' && <CrossTab />}
      {tab === 'funnel' && <FunnelTab />}
      {/* 検索からの流入は設計 6-11。実装は /search-console にある。
          タブごと隠すと、検索の流入を見られること自体が読み取れなくなる。 */}
      {tab === 'search' && (
        <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
          <p className="text-ink-secondary text-sm">
            検索からの流入は、いまは別の画面にあります。
          </p>
          <Link
            href="/search-console"
            className="text-accent mt-2 inline-block text-sm hover:underline"
          >
            検索からの流入を開く
          </Link>
        </div>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AnalyticsInner />
    </Suspense>
  )
}
