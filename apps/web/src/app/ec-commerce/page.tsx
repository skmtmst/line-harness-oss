'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api, type EcCommerceEvent, type EcCommerceOverview, type EcNotificationSetting } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const statusStyle: Record<EcCommerceEvent['status'], { label: string; className: string }> = {
  received: { label: '受信済み', className: 'bg-blue-50 text-blue-700' },
  identity_pending: { label: '会員の確認待ち', className: 'bg-warning-bg text-warning' },
  processing: { label: '処理中', className: 'bg-amber-50 text-amber-700' },
  processed: { label: '送信完了', className: 'bg-emerald-50 text-emerald-700' },
  skipped: { label: '送信なし', className: 'bg-canvas-sunken text-ink-secondary' },
  failed: { label: '失敗', className: 'bg-danger-bg text-danger' },
}

function dateTime(value: string | null) {
  if (!value) return 'まだありません'
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function MetricCard({ label, value, note, tone = 'green' }: { label: string; value: number | string; note: string; tone?: 'green' | 'red' | 'gray' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'gray' ? 'text-ink-secondary' : 'text-emerald-700'
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-faint">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-faint">{note}</p>
    </div>
  )
}

export default function EcCommercePage() {
  // Pen canonical: V2 9-3 EC連携。画面名は運用整理後の「ECデータ連携」を表示する。
  const { selectedAccountId } = useAccount()
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [events, setEvents] = useState<EcCommerceEvent[]>([])
  const [settings, setSettings] = useState<EcNotificationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [expandedEventType, setExpandedEventType] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setOverview(null)
      setEvents([])
      setSettings([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [overviewRes, eventRes, settingRes] = await Promise.all([
        api.ecCommerce.overview(selectedAccountId),
        api.ecCommerce.events({ lineAccountId: selectedAccountId, limit: 30 }),
        api.ecCommerce.settings(),
      ])
      if (!overviewRes.success || !eventRes.success || !settingRes.success) throw new Error('API error')
      /*
        **一覧の形を確かめてから state に入れる。**
        `success` が真でも中身が配列とはかぎらない（口が想定と違う形を返すと
        `{items:[],total:0}` のような物が入る）。そのまま入れると描画の途中で
        `events.map is not a function` を投げ、エラー境界が本文を丸ごと
        「画面を表示できませんでした」に置き換える。**1つの一覧が読めないだけで
        画面が消える。** 読めなかったこととして扱い、理由を本文の帯に出す。
      */
      if (!Array.isArray(eventRes.data) || !Array.isArray(settingRes.data)) throw new Error('API error')
      setOverview(overviewRes.data)
      setEvents(eventRes.data)
      const subscriptionSettings = settingRes.data.filter((setting) =>
        !['ec.order.confirmed', 'ec.order.shipped'].includes(setting.eventType),
      )
      setSettings(subscriptionSettings)
      setExpandedEventType((current) => current ?? subscriptionSettings[0]?.eventType ?? null)
    } catch {
      setMessage({ tone: 'error', text: 'ECデータ連携の情報を読み込めませんでした。時間をおいて再度お試しください。' })
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

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
      await api.ecCommerce.updateSetting(setting.eventType, {
        isEnabled: setting.isEnabled,
        title: setting.title,
        introText: setting.introText,
        outroText: setting.outroText,
        buttonLabel: setting.buttonLabel,
        buttonUrl: setting.buttonUrl,
        imageUrl: setting.imageUrl,
      })
      setMessage({ tone: 'success', text: `${setting.label}の通知設定を保存しました。` })
    } catch {
      setMessage({ tone: 'error', text: '通知設定を保存できませんでした。' })
    } finally {
      setSaving(null)
    }
  }

  const livePreview = (setting: EcNotificationSetting) => [
    setting.title?.trim() || '',
    setting.introText.trim(),
    setting.fixedPreview,
    setting.outroText.trim(),
  ].filter(Boolean).join('\n\n')

  const toggleSetting = async (setting: EcNotificationSetting) => {
    const isEnabled = !setting.isEnabled
    updateDraft(setting.eventType, { isEnabled })
    setSaving(setting.eventType)
    setMessage(null)
    try {
      await api.ecCommerce.updateSetting(setting.eventType, {
        isEnabled,
        title: setting.title || '',
        introText: setting.introText,
        outroText: setting.outroText,
        buttonLabel: setting.buttonLabel,
        buttonUrl: setting.buttonUrl,
        imageUrl: setting.imageUrl,
      })
      setMessage({ tone: 'success', text: `${setting.label}を${isEnabled ? 'ON' : 'OFF'}にしました。` })
    } catch {
      updateDraft(setting.eventType, { isEnabled: setting.isEnabled })
      setMessage({ tone: 'error', text: '通知のON/OFFを保存できませんでした。' })
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
      const result = await api.ecCommerce.testSend({
        eventType: setting.eventType,
        accountId: selectedAccountId,
        title: setting.title || '',
        introText: setting.introText,
        outroText: setting.outroText,
        buttonLabel: setting.buttonLabel,
        buttonUrl: setting.buttonUrl,
        imageUrl: setting.imageUrl,
      })
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
      <div data-design="Head">
        <Header
          title="ECデータ連携"
          description="ECサイトの購入・定期便の情報を取り込み、タグ付けやシナリオ配信につなげます。取り込んだ結果はここで確認できます。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              {/* 接続先や突合キーを画面から変える口が無い。 */}
              <button
                disabled
                title="連携設定は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                連携設定
              </button>
              <button
                onClick={() => void load()}
                className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border bg-white px-4 py-2 text-sm font-medium"
              >
                今すぐ同期
              </button>
            </div>
          }
        />
      </div>

      {message && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-danger-bg bg-danger-bg text-danger'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-hairline bg-white p-12 text-center text-sm text-ink-faint">読み込み中...</div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="24時間の受信" value={overview?.last24h ?? 0} note="ECから受け取ったイベント" />
              <MetricCard label="LINE送信完了" value={overview?.processed ?? 0} note={`累計 ${overview?.total ?? 0}件中`} />
              <MetricCard label="会員の確認待ち" value={overview?.identityPending ?? 0} note="LINEとのつき合わせが必要" tone="gray" />
              <MetricCard label="要確認" value={overview?.failed ?? 0} note={`最終受信 ${dateTime(overview?.lastReceivedAt ?? null)}`} tone="red" />
            </div>
          </section>

          <section className="hidden" aria-hidden="true">
            <div className="border-b border-hairline px-5 py-5 sm:px-6">
              <h2 className="text-lg font-bold text-ink">通知設定</h2>
              <p className="mt-1 text-sm text-ink-faint">OFFにしてもECイベントは記録され、ステップ配信の条件には利用できます。</p>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
              {settings.map((setting) => (
                <div key={setting.eventType} className="overflow-hidden rounded-2xl border border-hairline bg-white">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="flex min-w-0 items-center gap-4">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={setting.isEnabled}
                        aria-label={`${setting.label}の通知を${setting.isEnabled ? 'OFF' : 'ON'}にする`}
                        onClick={() => void toggleSetting(setting)}
                        disabled={saving === setting.eventType}
                        className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 ${setting.isEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      >
                        <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${setting.isEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{setting.label}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${setting.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas-sunken text-ink-faint'}`}>
                            {setting.isEnabled ? '通知ON' : '通知OFF'}
                          </span>
                        </div>
                        <p className="mt-0.5 break-all text-xs text-ink-faint">{setting.eventType}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedEventType((current) => current === setting.eventType ? null : setting.eventType)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary hover:bg-canvas-sunken sm:w-auto"
                    >
                      {expandedEventType === setting.eventType ? '編集を閉じる' : '本文を確認・編集'}
                      <svg className={`h-4 w-4 transition-transform ${expandedEventType === setting.eventType ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {expandedEventType === setting.eventType && (
                    <div className="border-t border-hairline bg-canvas-sunken/70 p-4 sm:p-5">
                      <div className="grid gap-5 xl:grid-cols-2">
                        <div className="space-y-4">
                          <label className="block">
                            <span className="mb-1.5 block text-sm font-semibold text-ink-secondary">通知の見出し</span>
                            <input
                              value={setting.title ?? ''}
                              onChange={(event) => updateDraft(setting.eventType, { title: event.target.value })}
                              maxLength={80}
                              className="w-full rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm text-ink outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-sm font-semibold text-ink-secondary">必須情報の前に入れる文章</span>
                            <textarea
                              value={setting.introText}
                              onChange={(event) => updateDraft(setting.eventType, { introText: event.target.value })}
                              maxLength={800}
                              rows={4}
                              placeholder="例：このたびは然-NEN-をご利用いただきありがとうございます。"
                              className="w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm leading-6 text-ink outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            />
                            <span className="mt-1 block text-right text-xs text-ink-faint">{setting.introText.length}/800</span>
                          </label>

                          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
                            <div className="flex items-center gap-2">
                              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v1m-4 0h4m-6 8h8a2 2 0 002-2v-6a2 2 0 00-2-2h-1V7a5 5 0 00-10 0v3H6a2 2 0 00-2 2v6a2 2 0 002 2h4z" />
                              </svg>
                              <p className="text-sm font-semibold text-slate-700">必ず送信される情報（編集不可）</p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {setting.fixedFields.map((field) => (
                                <span key={field} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{field}</span>
                              ))}
                            </div>
                          </div>

                          <label className="block">
                            <span className="mb-1.5 block text-sm font-semibold text-ink-secondary">必須情報の後に入れる文章</span>
                            <textarea
                              value={setting.outroText}
                              onChange={(event) => updateDraft(setting.eventType, { outroText: event.target.value })}
                              maxLength={800}
                              rows={4}
                              placeholder="例：ご不明点がございましたら、このLINEへお気軽にご連絡ください。"
                              className="w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm leading-6 text-ink outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            />
                            <span className="mt-1 block text-right text-xs text-ink-faint">{setting.outroText.length}/800</span>
                          </label>
                        </div>

                        <div>
                          <div className="sticky top-5 rounded-2xl border border-hairline bg-white p-4 shadow-sm sm:p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-ink">送信内容プレビュー</p>
                                <p className="mt-0.5 text-xs text-ink-faint">テスト用の注文情報で表示しています</p>
                              </div>
                              <span className="rounded-pill bg-accent-soft px-2.5 py-1 text-xs font-semibold text-success">LINE</span>
                            </div>
                            <div className="mt-4 rounded-2xl rounded-tl-md bg-[#d9fdd3] p-4 text-sm leading-6 text-gray-800 shadow-sm">
                              <p className="whitespace-pre-wrap break-words">{livePreview(setting)}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-hairline pt-5 sm:flex-row sm:justify-end">
                        <button onClick={() => void testSend(setting)} disabled={testing === setting.eventType} className="rounded-xl border border-emerald-500 px-5 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                          {testing === setting.eventType ? '送信中...' : 'この内容をテスト送信'}
                        </button>
                        <button onClick={() => void saveSetting(setting)} disabled={saving === setting.eventType} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                          {saving === setting.eventType ? '保存中...' : '通知設定を保存'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
              <div className="border-b border-hairline px-5 py-5 sm:px-6">
                <h2 className="text-lg font-bold text-ink">イベント履歴</h2>
                <p className="mt-1 text-sm text-ink-faint">注文番号とLINE配信結果を確認できます。LINE user IDや決済情報は表示しません。</p>
              </div>
              {events.length === 0 ? (
                <div className="p-12 text-center text-sm text-ink-faint">まだECイベントはありません。</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {events.map((event) => {
                    const status = statusStyle[event.status]
                    return (
                      <div key={event.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{event.eventLabel}</p>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                          </div>
                          <p className="mt-1 text-sm text-ink-secondary">
                            注文番号：{event.orderNumber || '—'} <span className="mx-1 text-gray-300">/</span> {event.friendName || 'LINE未連携'}
                          </p>
                          {event.errorMessage && <p className="mt-1 text-xs text-red-600">{event.errorMessage}</p>}
                        </div>
                        <time className="shrink-0 text-xs text-ink-faint">{dateTime(event.receivedAt)}</time>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <aside className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">EC STEP</p>
              <h2 className="mt-2 text-xl font-bold text-ink">購入後の関係づくり</h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">注文完了などのECイベントを起点に、食べ方の案内、到着確認、次回提案を自動化できます。</p>
              <div className="mt-5 space-y-3 text-sm">
                <div className="rounded-xl bg-white p-3.5 text-ink-secondary ring-1 ring-emerald-100">1. 注文直後：お礼と商品案内</div>
                <div className="rounded-xl bg-white p-3.5 text-ink-secondary ring-1 ring-emerald-100">2. 到着後：与え方・保存方法</div>
                <div className="rounded-xl bg-white p-3.5 text-ink-secondary ring-1 ring-emerald-100">3. 継続後：定期便・関連商品の提案</div>
              </div>
              <Link href="/automations" className="mt-5 block rounded-xl bg-gray-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-gray-800">
                ECステップ配信を設定する
              </Link>
              <p className="mt-3 text-xs leading-5 text-ink-faint">定期便イベントは受信準備済みです。Stripe定期便本体の接続後に有効化します。</p>
            </aside>
          </section>
        </div>
      )}
    </div>
  )
}
