'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api, type EcCommerceEvent, type EcCommerceOverview, type EcNotificationSetting } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const statusStyle: Record<EcCommerceEvent['status'], { label: string; className: string }> = {
  received: { label: '受信済み', className: 'bg-blue-50 text-blue-700' },
  processing: { label: '処理中', className: 'bg-amber-50 text-amber-700' },
  processed: { label: '送信完了', className: 'bg-emerald-50 text-emerald-700' },
  skipped: { label: '送信なし', className: 'bg-gray-100 text-gray-600' },
  failed: { label: '失敗', className: 'bg-red-50 text-red-700' },
}

function dateTime(value: string | null) {
  if (!value) return 'まだありません'
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function MetricCard({ label, value, note, tone = 'green' }: { label: string; value: number | string; note: string; tone?: 'green' | 'red' | 'gray' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'gray' ? 'text-gray-700' : 'text-emerald-700'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{note}</p>
    </div>
  )
}

export default function EcCommercePage() {
  const { selectedAccountId } = useAccount()
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [events, setEvents] = useState<EcCommerceEvent[]>([])
  const [settings, setSettings] = useState<EcNotificationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewRes, eventRes, settingRes] = await Promise.all([
        api.ecCommerce.overview(),
        api.ecCommerce.events({ limit: 30 }),
        api.ecCommerce.settings(),
      ])
      if (!overviewRes.success || !eventRes.success || !settingRes.success) throw new Error('API error')
      setOverview(overviewRes.data)
      setEvents(eventRes.data)
      setSettings(settingRes.data)
    } catch {
      setMessage({ tone: 'error', text: 'EC連携情報を読み込めませんでした。時間をおいて再度お試しください。' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const updateDraft = (eventType: string, patch: Partial<EcNotificationSetting>) => {
    setSettings((current) => current.map((setting) => setting.eventType === eventType ? { ...setting, ...patch } : setting))
  }

  const saveSetting = async (setting: EcNotificationSetting) => {
    if (!setting.title?.trim()) {
      setMessage({ tone: 'error', text: '通知タイトルを入力してください。' })
      return
    }
    setSaving(setting.eventType)
    setMessage(null)
    try {
      await api.ecCommerce.updateSetting(setting.eventType, { isEnabled: setting.isEnabled, title: setting.title })
      setMessage({ tone: 'success', text: `${setting.label}の通知設定を保存しました。` })
    } catch {
      setMessage({ tone: 'error', text: '通知設定を保存できませんでした。' })
    } finally {
      setSaving(null)
    }
  }

  const testSend = async (setting: EcNotificationSetting) => {
    if (!selectedAccountId) {
      setMessage({ tone: 'error', text: '左メニュー上部でLINEアカウントを選択してください。' })
      return
    }
    setTesting(setting.eventType)
    setMessage(null)
    try {
      const result = await api.ecCommerce.testSend({ eventType: setting.eventType, accountId: selectedAccountId })
      if (!result.success) throw new Error(result.error)
      setMessage({ tone: 'success', text: `テスト受信者 ${result.data.sent}名へ送信しました。` })
    } catch {
      setMessage({ tone: 'error', text: 'テスト送信できませんでした。「設定 → LINEアカウント」でテスト受信者を確認してください。' })
    } finally {
      setTesting(null)
    }
  }

  return (
    <div>
      <Header
        title="EC連携"
        description="然-NEN-の注文・発送・定期便通知を、ここから確認・管理できます。"
        action={(
          <button onClick={() => void load()} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            再読み込み
          </button>
        )}
      />

      {message && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="24時間の受信" value={overview?.last24h ?? 0} note="ECから受け取ったイベント" />
              <MetricCard label="LINE送信完了" value={overview?.processed ?? 0} note={`累計 ${overview?.total ?? 0}件中`} />
              <MetricCard label="送信なし" value={overview?.skipped ?? 0} note="未連携・通知OFFを含む" tone="gray" />
              <MetricCard label="要確認" value={overview?.failed ?? 0} note={`最終受信 ${dateTime(overview?.lastReceivedAt ?? null)}`} tone="red" />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
              <h2 className="text-lg font-bold text-gray-900">通知設定</h2>
              <p className="mt-1 text-sm text-gray-500">OFFにしてもECイベントは記録され、ステップ配信の条件には利用できます。</p>
            </div>
            <div className="divide-y divide-gray-100">
              {settings.map((setting) => (
                <div key={setting.eventType} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={setting.isEnabled}
                        onClick={() => updateDraft(setting.eventType, { isEnabled: !setting.isEnabled })}
                        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${setting.isEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${setting.isEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900">{setting.label}</p>
                        <p className="mt-0.5 break-all text-xs text-gray-400">{setting.eventType}</p>
                      </div>
                    </div>
                    <label className="block flex-[2]">
                      <span className="mb-1.5 block text-xs font-medium text-gray-600">通知の見出し</span>
                      <input
                        value={setting.title ?? ''}
                        onChange={(event) => updateDraft(setting.eventType, { title: event.target.value })}
                        maxLength={80}
                        className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => void testSend(setting)} disabled={testing === setting.eventType} className="rounded-xl border border-emerald-500 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                        {testing === setting.eventType ? '送信中...' : 'テスト送信'}
                      </button>
                      <button onClick={() => void saveSetting(setting)} disabled={saving === setting.eventType} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        {saving === setting.eventType ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
                <h2 className="text-lg font-bold text-gray-900">イベント履歴</h2>
                <p className="mt-1 text-sm text-gray-500">注文番号とLINE配信結果を確認できます。LINE user IDや決済情報は表示しません。</p>
              </div>
              {events.length === 0 ? (
                <div className="p-12 text-center text-sm text-gray-400">まだECイベントはありません。</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {events.map((event) => {
                    const status = statusStyle[event.status]
                    return (
                      <div key={event.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-gray-900">{event.eventLabel}</p>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            注文番号：{event.orderNumber || '—'} <span className="mx-1 text-gray-300">/</span> {event.friendName || 'LINE未連携'}
                          </p>
                          {event.errorMessage && <p className="mt-1 text-xs text-red-600">{event.errorMessage}</p>}
                        </div>
                        <time className="shrink-0 text-xs text-gray-400">{dateTime(event.receivedAt)}</time>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <aside className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">EC STEP</p>
              <h2 className="mt-2 text-xl font-bold text-gray-900">購入後の関係づくり</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">注文完了などのECイベントを起点に、食べ方の案内、到着確認、次回提案を自動化できます。</p>
              <div className="mt-5 space-y-3 text-sm">
                <div className="rounded-xl bg-white p-3.5 text-gray-700 ring-1 ring-emerald-100">1. 注文直後：お礼と商品案内</div>
                <div className="rounded-xl bg-white p-3.5 text-gray-700 ring-1 ring-emerald-100">2. 到着後：与え方・保存方法</div>
                <div className="rounded-xl bg-white p-3.5 text-gray-700 ring-1 ring-emerald-100">3. 継続後：定期便・関連商品の提案</div>
              </div>
              <Link href="/automations" className="mt-5 block rounded-xl bg-gray-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-gray-800">
                ECステップ配信を設定する
              </Link>
              <p className="mt-3 text-xs leading-5 text-gray-500">定期便イベントは受信準備済みです。Stripe定期便本体の接続後に有効化します。</p>
            </aside>
          </section>
        </div>
      )}
    </div>
  )
}
