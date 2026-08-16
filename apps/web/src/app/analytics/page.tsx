'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FriendField } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'

const TABS = [
  { key: 'messages', label: '配信' },
  { key: 'clicks', label: 'URLクリック' },
  { key: 'cross', label: 'クロス集計' },
  { key: 'funnel', label: 'ファネル' },
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

function MessagesTab() {
  const [days, setDays] = useState(28)
  const [rows, setRows] = useState<Array<{ date: string; outgoing: number; incoming: number }>>([])
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
        (acc, r) => ({ outgoing: acc.outgoing + r.outgoing, incoming: acc.incoming + r.incoming }),
        { outgoing: 0, incoming: 0 },
      ),
    [rows],
  )

  return (
    <div>
      <RangePicker days={days} onChange={setDays} />
      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">送信</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {totals.outgoing.toLocaleString('ja-JP')}
              </p>
            </div>
            <div className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">受信</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {totals.incoming.toLocaleString('ja-JP')}
              </p>
            </div>
          </div>

          <div className="bg-canvas rounded-card border-hairline mb-4 border p-4">
            <p className="text-ink-secondary mb-3 text-sm font-medium">日ごとの送信数</p>
            {rows.length === 0 ? (
              <p className="text-ink-faint py-8 text-center text-sm">この期間の記録はありません。</p>
            ) : (
              <Bars items={rows.map((r) => ({ label: r.date, value: r.outgoing }))} />
            )}
          </div>

          <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                    一斉配信
                  </th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                    届いた数
                  </th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                    開封
                  </th>
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                    クリック
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {broadcasts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-ink-faint px-4 py-8 text-center text-sm">
                      この期間の配信はありません。
                    </td>
                  </tr>
                ) : (
                  broadcasts.map((b) => (
                    <tr key={b.broadcastId} className="hover:bg-canvas-sunken">
                      <td className="text-ink px-4 py-3 text-sm">
                        {b.name}
                        <span className="text-ink-faint ml-2 text-xs">
                          {b.sentAt ? new Date(b.sentAt).toLocaleDateString('ja-JP') : ''}
                        </span>
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                        {b.delivered?.toLocaleString('ja-JP') ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {b.uniqueImpression != null ? (
                          <span className="text-ink-secondary">
                            {b.uniqueImpression.toLocaleString('ja-JP')}
                          </span>
                        ) : (
                          // 0 として描くと「誰も読んでいない」に見える。
                          <span
                            className="text-ink-faint"
                            title={
                              b.suppressedByAudienceSize
                                ? '配信先が20人未満のため、LINEから開封数が返りません'
                                : 'まだ集計されていません'
                            }
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                        {b.uniqueClick?.toLocaleString('ja-JP') ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-ink-faint mt-3 text-xs leading-relaxed">
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
      <Header title="アクセス解析" description="配信・クリック・友だちの属性を数えます。" />
      <MergedTabs basePath="/analytics" tabs={TABS} active={tab} />
      {tab === 'messages' && <MessagesTab />}
      {tab === 'clicks' && <ClicksTab />}
      {tab === 'cross' && <CrossTab />}
      {tab === 'funnel' && <FunnelTab />}
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
