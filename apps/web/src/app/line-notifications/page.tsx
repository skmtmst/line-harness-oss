'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import NotificationRunList from '@/components/line-notifications/notification-run-list'
import OperatorNotificationRules from '@/components/line-notifications/operator-notification-rules'
import Button from '@/components/shared/button'
import { api, type EcCommerceOverview, type EcNotificationSetting } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canOpenCustomerNotificationKpi, customerNotificationKpis } from './customer-kpis'
import styles from './customer-notifications.module.css'

const categories = [
  ['all', 'すべて'], ['order', '注文'], ['payment', '銀行振込'],
  ['shipping', '発送'], ['support', 'キャンセル・返金'], ['subscription', '定期便'],
] as const
type Category = typeof categories[number][0]

/**
 * 見出しの下に、**内部のイベントキーを出さない**。
 *
 * ここは `ec_order.confirmed` のような値をそのまま描き、全文を `title` にも
 * 入れていた。設計 `Q55bb` の言う「運用者に伝わる言葉」ではないし、
 * V6の「内部IDを画面に出さない」にも反する。
 * 区分の言葉は上の絞り込みが既に持っているので、それを使う。
 */
function categoryLabel(value: EcNotificationSetting['category']): string {
  return categories.find(([key]) => key === value)?.[1] ?? '区分なし'
}

/** 「いつ直したか」。取れないときは数を作らず `—`。 */
function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '最終更新 —'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '最終更新 —'
  return `最終更新 ${date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })}`
}

const TABS = [
  { key: 'customer', label: '顧客へのお知らせ' },
  { key: 'operator', label: '運用者へのお知らせ' },
  { key: 'failures', label: '送れなかったもの' },
  { key: 'history', label: '記録' },
] as const

function Toggle({ setting, busy, onToggle }: { setting: EcNotificationSetting; busy: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={setting.isEnabled} disabled={busy} onClick={onToggle}
    className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-50 ${setting.isEnabled ? 'bg-accent' : 'bg-hairline'}`}>
    <span className={`h-5 w-5 rounded-full bg-canvas shadow-sm transition-transform ${setting.isEnabled ? 'translate-x-5' : ''}`} />
  </button>
}

function CardPreview({ setting }: { setting: EcNotificationSetting }) {
  return <div className="border-nen-border bg-nen-ivory overflow-hidden rounded-[24px] border shadow-lg">
    {setting.imageUrl && <img src={setting.imageUrl} alt="" className="aspect-[20/9] w-full object-cover" />}
    <div className="p-5">
      <div className="border-nen-gold-soft flex items-center gap-2 border-b pb-3">
        <span className="text-nen-gold font-serif text-xl font-bold">然</span>
        <span className="text-nen-green text-[10px] font-bold tracking-[.22em]">NEN</span>
        <span className="text-nen-label ml-auto text-[10px] font-semibold">LINE NOTIFICATION</span>
      </div>
      <h3 className="text-nen-green mt-4 text-xl font-bold leading-7">{setting.title}</h3>
      {setting.introText && <p className="text-nen-copy mt-3 whitespace-pre-wrap text-sm leading-6">{setting.introText}</p>}
      <div className="border-nen-gold-soft mt-4 space-y-3 border-t pt-4">
        {setting.fixedFields.slice(0, 5).map((field, index) => <div key={field}>
          <p className="text-nen-label text-[10px] font-bold">{field}</p>
          <p className="text-nen-ink mt-0.5 text-sm">{index === 0 ? 'NEN-TEST-001' : index === 1 ? '鹿肉ミンチ × 2' : '注文情報から自動表示'}</p>
        </div>)}
      </div>
      {setting.outroText && <p className="text-nen-muted mt-4 whitespace-pre-wrap text-xs leading-5">{setting.outroText}</p>}
      {setting.buttonLabel && <div className="bg-nen-green text-on-accent mt-5 rounded-xl px-4 py-3 text-center text-sm font-semibold">{setting.buttonLabel}</div>}
    </div>
  </div>
}

export default function LineNotificationsPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const tab = useMergedTab(TABS, 'tab', 'customer')
  const [settings, setSettings] = useState<EcNotificationSetting[]>([])
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const loadGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    if (tab !== 'customer') {
      setLoading(false)
      return
    }
    setLoading(true)
    // アカウント切替中に前のアカウントの件数を残さない。
    setSettings([])
    setOverview(null)
    setNotice(null)
    try {
      const [settingRes, overviewRes] = await Promise.all([
        api.ecCommerce.settings(), api.ecCommerce.overview(selectedAccountId ?? undefined),
      ])
      if (generation !== loadGeneration.current) return
      if (!settingRes.success || !overviewRes.success) throw new Error('load failed')
      setSettings(settingRes.data)
      setOverview(overviewRes.data)
      setExpanded((current) => current ?? settingRes.data[0]?.eventType ?? null)
    } catch {
      if (generation === loadGeneration.current) {
        setNotice({ tone: 'error', text: 'LINE通知の設定を読み込めませんでした。' })
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [selectedAccountId, tab])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => category === 'all' ? settings : settings.filter((setting) => setting.category === category), [category, settings])
  const kpis = customerNotificationKpis({
    ready: !loading && overview !== null,
    settingsCount: settings.length,
    enabledCount: settings.filter((setting) => setting.isEnabled).length,
    processed: overview?.processed ?? null,
    failed: overview?.failed ?? null,
  })
  const update = (eventType: string, patch: Partial<EcNotificationSetting>) => setSettings((current) => current.map((setting) => setting.eventType === eventType ? { ...setting, ...patch } : setting))

  const save = async (setting: EcNotificationSetting, enabled = setting.isEnabled) => {
    if (!setting.title?.trim()) { setNotice({ tone: 'error', text: '通知の見出しを入力してください。' }); return }
    setBusy(setting.eventType)
    try {
      await api.ecCommerce.updateSetting(setting.eventType, {
        isEnabled: enabled, title: setting.title, introText: setting.introText, outroText: setting.outroText,
        buttonLabel: setting.buttonLabel, buttonUrl: setting.buttonUrl, imageUrl: setting.imageUrl,
      })
      update(setting.eventType, { isEnabled: enabled })
      setNotice({ tone: 'success', text: `${setting.label}を保存しました。` })
    } catch { setNotice({ tone: 'error', text: `${setting.label}を保存できませんでした。` }) }
    finally { setBusy(null) }
  }

  const testSend = async (setting: EcNotificationSetting) => {
    if (!selectedAccountId) { setNotice({ tone: 'error', text: 'LINEアカウントを選択してください。' }); return }
    setBusy(setting.eventType)
    try {
      const result = await api.ecCommerce.testSend({
        eventType: setting.eventType, accountId: selectedAccountId, title: setting.title || '',
        introText: setting.introText, outroText: setting.outroText, buttonLabel: setting.buttonLabel,
        buttonUrl: setting.buttonUrl, imageUrl: setting.imageUrl,
      })
      if (!result.success) throw new Error(result.error)
      setNotice({ tone: 'success', text: `テスト受信者 ${result.data.sent}名へ送信しました。` })
    } catch { setNotice({ tone: 'error', text: 'テスト送信できませんでした。テスト受信者の設定をご確認ください。' }) }
    finally { setBusy(null) }
  }

  return <>
    <MergedTabs basePath="/line-notifications" tabs={TABS} active={tab} defaultKey="customer" />
    {tab === 'failures' ? <NotificationRunList lineAccountId={selectedAccountId} mode="failures" /> : null}
    {tab === 'history' ? <NotificationRunList lineAccountId={selectedAccountId} mode="history" /> : null}
    {tab === 'operator' ? <OperatorNotificationRules lineAccountId={selectedAccountId} /> : null}
    {tab === 'customer' ? <>
    <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const { label, value, note, href } = kpi
        const body = <>
          <p className="text-ink-faint text-xs">{label}</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {value === null ? '—' : value}
            {value === null ? null : <span className="text-ink-faint ml-1 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">{note}</p>
        </>
        return <div key={label} className="bg-canvas rounded-card border-hairline border p-4">
          {body}
          {/* 0件のときは押し口を出さない。押しても何も無い。 */}
          {canOpenCustomerNotificationKpi(kpi) && href
            ? <Button onClick={() => router.replace(href)} className="mt-2">送れなかったものを見る</Button>
            : null}
        </div>
      })}
    </div>
    <main className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="bg-canvas rounded-card border-hairline h-fit border p-2 lg:sticky lg:top-4">
        <p className="text-ink-faint px-3 pb-2 pt-3 text-xs font-bold">通知の種類</p>
        {categories.map(([value, label]) => <button key={value} type="button" onClick={() => setCategory(value)} className={`${styles.category} ${category === value ? styles.categoryCurrent : ''}`}><span>{label}</span><span className={styles.categoryCount}>{value === 'all' ? settings.length : settings.filter((x) => x.category === value).length}</span></button>)}
        <div className="border-hairline mt-3 border-t p-3 text-xs leading-5 text-ink-faint">通知のON/OFFを切り替えても、ECから受け取った履歴は残ります。</div>
      </aside>
      <section className="min-w-0 space-y-3">
        {notice && <div className={`rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}
        {loading ? <div className="bg-canvas rounded-card border-hairline border p-12 text-center text-sm text-ink-faint">読み込み中...</div> : visible.map((setting) => <article key={setting.eventType} className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><Toggle setting={setting} busy={busy === setting.eventType} onToggle={() => void save(setting, !setting.isEnabled)} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-ink">{setting.label}</h2><span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${setting.isEnabled ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{setting.isEnabled ? '通知ON' : '通知OFF'}</span></div><p className="mt-0.5 truncate text-xs text-ink-faint">{categoryLabel(setting.category)}・{formatUpdatedAt(setting.updatedAt)}</p></div></div>
            <button type="button" onClick={() => setExpanded(expanded === setting.eventType ? null : setting.eventType)} className={styles.rowAction}>{expanded === setting.eventType ? '編集を閉じる' : '内容を編集'}</button>
          </div>
          {expanded === setting.eventType && <div className="border-hairline bg-canvas-sunken/60 grid gap-5 border-t p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <label className="block text-sm font-semibold text-ink-secondary">通知の見出し<input value={setting.title ?? ''} maxLength={80} onChange={(e) => update(setting.eventType, { title: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal text-ink" /></label>
              <label className="block text-sm font-semibold text-ink-secondary">ご案内文<textarea value={setting.introText} maxLength={800} rows={4} onChange={(e) => update(setting.eventType, { introText: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
              <div className="border-nen-border bg-nen-ivory rounded-control border p-4"><p className="text-nen-green text-sm font-bold">注文情報から自動表示</p><div className="mt-2 flex flex-wrap gap-2">{setting.fixedFields.map((field) => <span key={field} className="bg-canvas text-nen-chip ring-nen-gold-soft rounded-md px-2 py-1 text-xs ring-1">{field}</span>)}</div></div>
              <label className="block text-sm font-semibold text-ink-secondary">結びの文章<textarea value={setting.outroText} maxLength={800} rows={3} onChange={(e) => update(setting.eventType, { outroText: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-ink-secondary">ボタン名<input value={setting.buttonLabel} maxLength={20} onChange={(e) => update(setting.eventType, { buttonLabel: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal" /></label><label className="block text-sm font-semibold text-ink-secondary">ボタンURL<input value={setting.buttonUrl} placeholder="注文情報のURLを使う場合は空欄" onChange={(e) => update(setting.eventType, { buttonUrl: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal" /></label></div>
              <label className="block text-sm font-semibold text-ink-secondary">カード画像URL<input value={setting.imageUrl} placeholder="未設定の場合はロゴ中心のカード" onChange={(e) => update(setting.eventType, { imageUrl: e.target.value })} className="border-hairline mt-1.5 w-full rounded-control border bg-white px-3 py-2.5 font-normal" /></label>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => void testSend(setting)} disabled={busy === setting.eventType} className={`${styles.action} ${styles.actionSecondary}`}>テスト送信</button><button type="button" onClick={() => void save(setting)} disabled={busy === setting.eventType} className={`${styles.action} ${styles.actionPrimary}`}>設定を保存</button></div>
            </div>
            <div className="min-w-0"><p className="mb-2 text-xs font-semibold text-ink-faint">LINEプレビュー</p><CardPreview setting={setting} /></div>
          </div>}
        </article>)}
      </section>
    </main>
    </> : null}
  </>
}
