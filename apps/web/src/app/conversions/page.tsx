'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'

const EMPTY_FORM = {
  name: '',
  eventType: '',
  value: '',
  measureMethod: 'manual' as 'url_reach' | 'webhook' | 'manual',
  targetUrl: '',
  countRepeat: true,
  attributionDays: '',
}

/** 数え方を運用者の言葉にする。既定（manual）も省略せずに出す。 */
function measureLabel(method: ConversionPoint['measureMethod']): string {
  if (method === 'url_reach') return 'URL到達'
  if (method === 'webhook') return '外部通知'
  return '手動'
}
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import AffiliatesPage from '@/app/affiliates/page'

interface ConversionReportItem {
  conversionPointId: string
  conversionPointName: string
  eventType: string
  totalCount: number
  totalValue: number
}

const ccPrompts = [
  {
    title: 'CV計測ポイント設定',
    prompt: `コンバージョン計測ポイントの設定をサポートしてください。
1. 主要なイベントタイプ（友だち追加、URLクリック、購入完了等）の説明
2. 各CVポイントに設定すべき金額の目安を提案
3. CVファネル全体の計測設計のベストプラクティス
手順を示してください。`,
  },
  {
    title: 'コンバージョン分析',
    prompt: `現在のコンバージョンデータを分析してください。
1. CVポイント別の発火回数と金額を集計
2. イベントタイプ別のCV率とトレンドを分析
3. CV率向上のための改善施策を提案
結果をレポートしてください。`,
  },
]

const MERGED_TABS = [
  { key: 'points', label: '成果地点' },
  { key: 'affiliates', label: 'アフィリエイト' },
]

function ConversionsPageInner() {
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = async () => {
    setLoading(true)
    try {
      const [pointsRes, reportRes] = await Promise.allSettled([
        api.conversions.points(),
        api.conversions.report(),
      ])
      if (pointsRes.status === 'fulfilled' && pointsRes.value.success) setPoints(pointsRes.value.data)
      if (reportRes.status === 'fulfilled' && reportRes.value.success) setReport(reportRes.value.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.eventType) return
    // サーバー側でも弾くが、押してからエラーで戻されるより、押す前に止める。
    if (form.measureMethod === 'url_reach' && !form.targetUrl.trim()) return
    try {
      await api.conversions.createPoint({
        name: form.name,
        eventType: form.eventType,
        value: form.value ? Number(form.value) : null,
        measureMethod: form.measureMethod,
        targetUrl: form.measureMethod === 'url_reach' ? form.targetUrl.trim() : null,
        countRepeat: form.countRepeat,
        attributionDays: form.attributionDays ? Number(form.attributionDays) : null,
      })
      setForm(EMPTY_FORM)
      setShowCreate(false)
      load()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このCVポイントを削除しますか？')) return
    await api.conversions.deletePoint(id)
    load()
  }

  const eventTypes = [
    { value: 'friend_add', label: '友だち追加' },
    { value: 'rich_menu_tap', label: 'リッチメニュータップ' },
    { value: 'url_click', label: 'URLクリック' },
    { value: 'form_submit', label: 'フォーム送信' },
    { value: 'keyword_sent', label: 'キーワード送信' },
    { value: 'scenario_step', label: 'シナリオステップ到達' },
    { value: 'liff_view', label: 'LIFF閲覧' },
    { value: 'purchase', label: '購入完了' },
    { value: 'custom', label: 'カスタム' },
  ]

  return (
    <div>
      <Header
        title="コンバージョン計測"
        description="CVポイント定義 & レポート"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover px-4 py-2 min-h-[44px] rounded-control text-sm font-medium"
          >
            {showCreate ? 'キャンセル' : '+ CVポイント作成'}
          </button>
        }
      />

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-canvas rounded-card border border-hairline p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">CV名</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="購入完了"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">イベントタイプ</label>
              <select
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              >
                <option value="">選択...</option>
                {eventTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">金額 (任意)</label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
          </div>

          {/* どうやって数えるか。ここを決めないと、作っただけで1件も増えない。 */}
          <div className="border-hairline mt-4 space-y-4 rounded-lg border p-4">
            <p className="text-ink-secondary text-sm font-semibold">数え方</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="cv-method" className="text-ink-secondary mb-1 block text-sm font-medium">
                  計測方法
                </label>
                <select
                  id="cv-method"
                  value={form.measureMethod}
                  onChange={(e) =>
                    setForm({ ...form, measureMethod: e.target.value as typeof form.measureMethod })
                  }
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                >
                  <option value="manual">手動で記録する</option>
                  <option value="url_reach">URLに到達したら数える</option>
                  <option value="webhook">外部から通知を受けて数える</option>
                </select>
              </div>
              {form.measureMethod === 'url_reach' && (
                <div className="sm:col-span-2">
                  <label htmlFor="cv-url" className="text-ink-secondary mb-1 block text-sm font-medium">
                    対象URL
                  </label>
                  <input
                    id="cv-url"
                    type="url"
                    value={form.targetUrl}
                    onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
                    className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    placeholder="https://example.com/thanks"
                    required
                  />
                  <p className="text-ink-faint mt-1 text-xs">
                    前方一致で見ます。<code>?utm_source=...</code> のような文字が後ろに付いても数えます。
                    計測リンク（/t/…）を踏んだ人だけが対象です。
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="cv-days" className="text-ink-secondary mb-1 block text-sm font-medium">
                  紹介を紐づける期間
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="cv-days"
                    type="number"
                    min={1}
                    max={365}
                    value={form.attributionDays}
                    onChange={(e) => setForm({ ...form, attributionDays: e.target.value })}
                    className="border-hairline rounded-control w-24 border px-3 py-2 text-sm tabular-nums"
                    placeholder="90"
                  />
                  <span className="text-ink-faint text-xs">日</span>
                </div>
                <p className="text-ink-faint mt-1 text-xs">空欄なら既定の90日</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={!form.countRepeat}
                onChange={(e) => setForm({ ...form, countRepeat: !e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-ink-secondary text-sm">
                同じ人は一回だけ数える
                <span className="text-ink-faint block text-xs">
                  外すと、同じ人が何度でも数えられます（購入のように毎回数えたいとき）。
                </span>
              </span>
            </label>
          </div>

          <button
            type="submit"
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover mt-4 px-4 py-2 min-h-[44px] rounded-control text-sm font-medium"
          >
            作成
          </button>
        </form>
      )}

      {/* Report Cards */}
      {report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {report.map((r) => (
            <div key={r.conversionPointId} className="bg-canvas rounded-card border border-hairline p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-ink-secondary">{r.conversionPointName}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{r.eventType}</span>
              </div>
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-2xl font-bold text-ink">{r.totalCount}</p>
                  <p className="text-xs text-ink-faint">CV数</p>
                </div>
                {r.totalValue > 0 && (
                  <div>
                    <p className="text-lg font-semibold text-green-600">{r.totalValue.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY' })}</p>
                    <p className="text-xs text-ink-faint">売上</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Points Table */}
      {loading ? (
        <div className="bg-canvas rounded-card border border-hairline p-8 text-center text-ink-faint">読み込み中...</div>
      ) : points.length === 0 ? (
        <div className="bg-canvas rounded-card border border-hairline p-8 text-center text-ink-faint">CVポイントがまだありません</div>
      ) : (
        <div className="bg-canvas rounded-card border border-hairline overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead className="bg-canvas-sunken border-b border-hairline">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-faint uppercase">CV名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-faint uppercase">イベントタイプ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-faint uppercase">金額</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-faint uppercase">数え方</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-faint uppercase">作成日</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-ink-faint uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {points.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="px-4 py-3 text-sm font-medium text-ink">{point.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{point.eventType}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                        {measureLabel(point.measureMethod)}
                      </span>
                      {point.countRepeat === false && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                          一人一回
                        </span>
                      )}
                      {point.attributionDays != null && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap tabular-nums">
                          {point.attributionDays}日
                        </span>
                      )}
                    </div>
                    {point.targetUrl && (
                      <p className="text-ink-faint mt-1 max-w-[22rem] truncate text-[11px]" title={point.targetUrl}>
                        {point.targetUrl}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-faint">{new Date(point.createdAt).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(point.id)}
                      className="text-red-500 hover:text-danger text-sm"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}

function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      <MergedTabs basePath="/conversions" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'points' && <ConversionsPageInner />}
      {tab === 'affiliates' && <AffiliatesPage />}
    </div>
  )
}

export default function ConversionsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ConversionsPageHost />
    </Suspense>
  )
}
