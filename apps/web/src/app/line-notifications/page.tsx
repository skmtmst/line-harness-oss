'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import NotificationRunList from '@/components/line-notifications/notification-run-list'
import OperatorNotificationRules from '@/components/line-notifications/operator-notification-rules'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { ApiError, api, type EcCommerceOverview, type EcNotificationSetting } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canOpenCustomerNotificationKpi, customerNotificationKpis } from './customer-kpis'
import styles from './customer-notifications.module.css'

const customerFilters = [
  ['all', 'すべて'],
  ['enabled', '出している'],
  ['stopped', '止めている'],
  ['incomplete', '文面が未設定'],
] as const
type CustomerFilter = typeof customerFilters[number][0]
type CustomerLoadState = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 見出しの下に、**内部のイベントキーを出さない**。
 *
 * ここは `ec_order.confirmed` のような値をそのまま描き、全文を `title` にも
 * 入れていた。設計 `Q55bb` の言う「運用者に伝わる言葉」ではないし、
 * V6の「内部IDを画面に出さない」にも反する。
 * 区分の言葉は上の絞り込みが既に持っているので、それを使う。
 */
function isIncomplete(setting: EcNotificationSetting): boolean {
  return !setting.title?.trim() || !setting.introText.trim() || !setting.outroText.trim()
}

function triggerLabel(setting: EcNotificationSetting): string {
  return `${setting.label}とき ／ EC連携から`
}

function timingLabel(setting: EcNotificationSetting): string {
  if (setting.category === 'subscription') return '設定した日時'
  return `${setting.label}らすぐ`
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
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<CustomerLoadState>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const loadGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setLoadState('loading')
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
      setExpanded((current) => settingRes.data.some((setting) => setting.eventType === current) ? current : null)
      setLoadState('ready')
    } catch (error) {
      if (generation === loadGeneration.current) {
        setLoadState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
        setNotice({ tone: 'error', text: 'LINE通知の設定を読み込めませんでした。' })
      }
    }
  }, [selectedAccountId])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => settings.filter((setting) => {
    if (filter === 'enabled') return setting.isEnabled
    if (filter === 'stopped') return !setting.isEnabled
    if (filter === 'incomplete') return isIncomplete(setting)
    return true
  }), [filter, settings])
  const filterCount = (value: CustomerFilter): number => {
    if (value === 'enabled') return settings.filter((setting) => setting.isEnabled).length
    if (value === 'stopped') return settings.filter((setting) => !setting.isEnabled).length
    if (value === 'incomplete') return settings.filter(isIncomplete).length
    return settings.length
  }
  const sentBreakdown = overview?.byType.slice(0, 3).map((item) => `${item.label} ${item.count}`).join('・') ?? ''
  const kpis = customerNotificationKpis({
    ready: loadState === 'ready' && overview !== null,
    settingsCount: settings.length,
    enabledCount: settings.filter((setting) => setting.isEnabled).length,
    sentToday: overview?.last24h ?? null,
    sentBreakdown,
    failed: overview?.failed ?? null,
  })
  const tabsWithCounts = TABS.map((item) => {
    if (item.key === 'customer') return { ...item, label: `${item.label} ${loadState === 'ready' ? settings.length : '—'}` }
    if (item.key === 'operator') return { ...item, label: `${item.label} —` }
    if (item.key === 'failures') return { ...item, label: `${item.label} ${overview?.failed ?? '—'}` }
    return item
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
    <MergedTabs basePath="/line-notifications" tabs={tabsWithCounts} active={tab} defaultKey="customer" />
    {tab === 'failures' ? <NotificationRunList lineAccountId={selectedAccountId} mode="failures" /> : null}
    {tab === 'history' ? <NotificationRunList lineAccountId={selectedAccountId} mode="history" /> : null}
    {tab === 'operator' ? <OperatorNotificationRules lineAccountId={selectedAccountId} /> : null}
    {tab === 'customer' ? <main
      data-design-node="festr"
      data-list-state={loadState === 'ready' && settings.length === 0 ? 'empty' : loadState}
      className={styles.root}
    >
    <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const { label, value, unit, note, href } = kpi
        const body = <>
          <p className="text-ink-faint text-xs">{label}</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {value === null ? '—' : value}
            {value === null ? null : <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>}
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
    <div className="border-info bg-info-bg text-info rounded-control border px-4 py-3 text-sm leading-6">
      これは「お知らせ」であって「売り込みの配信」ではありません。顧客が配信を止めていても、取引に必要な連絡は届きます。
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid w-full max-w-3xl grid-cols-2 gap-2 lg:grid-cols-4" aria-label="お知らせの絞り込み">
        {customerFilters.map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`${styles.category} ${filter === value ? styles.categoryCurrent : ''}`}><span>{label}</span><span className={styles.categoryCount}>{loadState === 'ready' ? filterCount(value) : '—'}</span></button>)}
      </div>
      <p className="text-xs text-ink-faint">送った数が多い順</p>
    </div>

    {notice && <div className={`rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}

    <section className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas">
      {loadState === 'loading' ? <ListState kind="loading" title="顧客へのお知らせを読み込んでいます" />
        : loadState === 'forbidden' ? <ListState kind="forbidden" />
        : loadState === 'error' ? <ListState kind="error" title="顧客へのお知らせを表示できませんでした" onRetry={() => void load()} />
        : settings.length === 0 ? <ListState kind="empty" title="顧客へのお知らせはまだありません" description="EC連携の取引イベントを接続すると、ここで種類ごとに管理できます。" />
        : visible.length === 0 ? <ListState kind="empty" title="条件に合うお知らせはありません" description="絞り込みを変えてください。" />
        : <>
        <div className="line-notification-v6-header">
          <span>お知らせ</span><span>いつ送るか</span><span>今日</span><span>この30日</span><span>状態</span><span>操作</span>
        </div>
        {visible.map((setting) => <article key={setting.eventType} className="border-b border-hairline last:border-b-0">
          <div className="line-notification-v6-row">
            <div className="min-w-0"><h2 className="truncate font-bold text-ink" title={setting.title?.trim() || setting.label}>{setting.title?.trim() || setting.label}</h2><p className="mt-0.5 truncate text-xs text-ink-faint" title={triggerLabel(setting)}>{triggerLabel(setting)}</p></div>
            <span className="text-sm text-ink-secondary">{timingLabel(setting)}</span>
            <span className="text-sm tabular-nums text-ink-secondary">{overview?.byType.find((item) => item.eventType === setting.eventType)?.count ?? '—'}通</span>
            <span className="text-sm text-ink-faint">—</span>
            <div className="flex items-center gap-2"><Toggle setting={setting} busy={busy === setting.eventType} onToggle={() => void save(setting, !setting.isEnabled)} /><span className={`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${setting.isEnabled ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{setting.isEnabled ? '出している' : '止めている'}</span></div>
            <button type="button" onClick={() => setExpanded(expanded === setting.eventType ? null : setting.eventType)} className="line-notification-v6-row-action">{expanded === setting.eventType ? '編集を閉じる' : '内容を編集'}</button>
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
        <p className="border-t border-hairline px-4 py-3 text-xs text-ink-faint">お知らせの種類 {settings.length}つのうち {visible.length}つを表示
        </p>
        </>}
    </section>
    </main> : null}
  </>
}
