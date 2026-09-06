'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import NotificationRunList from '@/components/line-notifications/notification-run-list'
import OperatorNotificationRules from '@/components/line-notifications/operator-notification-rules'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import {
  ApiError,
  api,
  type EcCommerceOverview,
  type EcNotificationSetting,
  type LineNotificationDefinition,
  type LineNotificationMetric,
} from '@/lib/api'
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
const categories = [
  ['order', '注文'],
  ['payment', '銀行振込'],
  ['shipping', '発送'],
  ['support', 'キャンセル・返金'],
  ['subscription', '定期便'],
] as const
const CUSTOMER_PAGE_SIZE = 6

/**
 * 見出しの下に、**内部のイベントキーを出さない**。
 *
 * ここは `ec_order.confirmed` のような値をそのまま描き、全文を `title` にも
 * 入れていた。設計 `Q55bb` の言う「運用者に伝わる言葉」ではないし、
 * V6の「内部IDを画面に出さない」にも反する。
 * APIが返す区分は、運用者が分かる言葉へ置き換える。
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

function CustomerNotificationEditor({
  setting,
  definition,
  busy,
  onChange,
  onClose,
  onPublish,
  onSave,
  onTestSend,
}: {
  setting: EcNotificationSetting
  definition: LineNotificationDefinition | null
  busy: boolean
  onChange: (patch: Partial<EcNotificationSetting>) => void
  onClose: () => void
  onPublish: () => void
  onSave: () => void
  onTestSend: () => void
}) {
  return <main data-design-node="Q55bb" className="space-y-4 pb-24">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold text-accent">LINE通知　›　お知らせの種類</p>
        <p className="mt-2 text-xl font-bold text-ink">「{setting.title?.trim() || setting.label}」を編集する</p>
        <p className="mt-1 text-xs text-ink-faint">{definition ? `公開版 ${definition.currentVersionNumber ? `v${definition.currentVersionNumber}` : 'なし'} ／ 編集中の下書き` : '公開中の内容を編集します。保存した内容は次の通知から使われます。'}</p>
      </div>
      <Button onClick={onTestSend} disabled={busy}>自分にテスト送信</Button>
    </div>

    <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 390px' }}>
      <div className="min-w-0 space-y-4">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">いつ送りますか</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div><p className="text-xs font-semibold text-ink-faint">きっかけ</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">{triggerLabel(setting)}</p></div>
            <div><p className="text-xs font-semibold text-ink-faint">送りかた</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">{timingLabel(setting)}</p></div>
            <div><p className="text-xs font-semibold text-ink-faint">送らない相手</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">なし（全員に送る）</p></div>
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">送るもの</h2>
          <div className="mt-3 space-y-4">
            <label className="block text-sm font-semibold text-ink-secondary">通知の見出し<input value={setting.title ?? ''} maxLength={80} onChange={(event) => onChange({ title: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal text-ink" /></label>
            <label className="block text-sm font-semibold text-ink-secondary">ご案内文<textarea value={setting.introText} maxLength={800} rows={5} onChange={(event) => onChange({ introText: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
            <div className="rounded-control border border-nen-border bg-nen-ivory p-4">
              <p className="text-sm font-bold text-nen-green">このお知らせで差し込める項目（EC連携から来ます）</p>
              <div className="mt-2 flex flex-wrap gap-2">{setting.fixedFields.map((field) => <span key={field} className="rounded-pill bg-canvas px-2.5 py-1 text-xs text-nen-chip ring-1 ring-nen-gold-soft">{field}</span>)}</div>
            </div>
            <label className="block text-sm font-semibold text-ink-secondary">結びの文章<textarea value={setting.outroText} maxLength={800} rows={3} onChange={(event) => onChange({ outroText: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">ボタン</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink-secondary">ボタンの文字<input value={setting.buttonLabel} maxLength={20} onChange={(event) => onChange({ buttonLabel: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-ink-secondary">押したときに開く先<input value={setting.buttonUrl} placeholder="注文情報のURLを使う場合は空欄" onChange={(event) => onChange({ buttonUrl: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
          </div>
          <label className="mt-3 block text-sm font-semibold text-ink-secondary">カード画像URL<input value={setting.imageUrl} placeholder="未設定の場合はロゴ中心のカード" onChange={(event) => onChange({ imageUrl: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">届かなかったときの決めごと</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">取引メールと対応済み記録は、送信台帳の接続後に設定できます。いまは受信箱から別の手だてで連絡してください。</p>
        </section>
      </div>

      <aside className="min-w-0 space-y-3">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <p className="mb-2 text-xs font-semibold text-ink-faint">高橋 直人さんにはこう届きます</p>
          <CardPreview setting={setting} />
        </section>
        <section className="rounded-card border border-warning bg-warning-bg p-4 text-sm text-warning">
          <h2 className="font-bold">これは「お知らせ」です</h2>
          <ul className="mt-2 space-y-2 leading-5"><li>配信を止めている人にも届きます</li><li>売り込みの文章は入れないでください</li><li>遅れると問い合わせが増えます</li></ul>
        </section>
        <section className="rounded-card border border-hairline bg-canvas p-4 text-sm">
          <h2 className="font-bold text-ink">つながる先</h2>
          <div className="mt-2 space-y-2 text-accent"><p>EC連携</p><p>共通情報</p><p>受信箱</p><p>NEN配信</p><p>外部連携</p></div>
        </section>
      </aside>
    </div>

    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-hairline bg-canvas px-6 py-3 shadow-lg">
      <div className="ml-auto flex flex-wrap items-center justify-between gap-3" style={{ maxWidth: 1584 }}>
        <p className="text-xs text-ink-faint">{definition ? '下書きの保存だけでは公開中の内容は変わりません。確認後に公開してください。' : '出しています。保存すると、次のお知らせから新しい文面が使われます。'}</p>
        <div className="flex gap-2"><Button onClick={onClose}>キャンセル</Button><Button onClick={onTestSend} disabled={busy}>自分にテスト送信</Button><Button onClick={onSave} disabled={busy}>{definition ? '下書きを保存' : 'お知らせを保存'}</Button>{definition ? <Button variant="primary" onClick={onPublish} disabled={busy}>顧客へのお知らせを公開</Button> : null}</div>
      </div>
    </div>
  </main>
}

export default function LineNotificationsPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const tab = useMergedTab(TABS, 'tab', 'customer')
  const [settings, setSettings] = useState<EcNotificationSetting[]>([])
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [definitions, setDefinitions] = useState<LineNotificationDefinition[]>([])
  const [metrics, setMetrics] = useState<LineNotificationMetric[]>([])
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [customerPage, setCustomerPage] = useState(1)
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
    setDefinitions([])
    setMetrics([])
    setNotice(null)
    try {
      const [settingRes, overviewRes, definitionRes, metricRes] = await Promise.all([
        api.ecCommerce.settings(), api.ecCommerce.overview(selectedAccountId ?? undefined),
        selectedAccountId
          ? api.lineNotifications.definitions(selectedAccountId).catch(() => null)
          : Promise.resolve(null),
        selectedAccountId
          ? api.lineNotifications.metrics(selectedAccountId).catch(() => null)
          : Promise.resolve(null),
      ])
      if (generation !== loadGeneration.current) return
      if (!settingRes.success || !overviewRes.success) throw new Error('load failed')
      setSettings(settingRes.data)
      setOverview(overviewRes.data)
      setDefinitions(definitionRes?.success ? definitionRes.data : [])
      setMetrics(metricRes?.success ? metricRes.data.items : [])
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
  const customerPageCount = Math.max(1, Math.ceil(visible.length / CUSTOMER_PAGE_SIZE))
  const visiblePage = visible.slice((customerPage - 1) * CUSTOMER_PAGE_SIZE, customerPage * CUSTOMER_PAGE_SIZE)
  const expandedSetting = settings.find((setting) => setting.eventType === expanded) ?? null
  const definitionByEvent = useMemo(() => new Map(definitions.map((definition) => [definition.sourceEventType, definition])), [definitions])
  const metricByEvent = useMemo(() => {
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition.sourceEventType]))
    return new Map(metrics.flatMap((metric) => {
      const eventType = definitionById.get(metric.definitionId)
      return eventType ? [[eventType, metric] as const] : []
    }))
  }, [definitions, metrics])
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
      const definition = definitionByEvent.get(setting.eventType)
      if (definition && enabled === setting.isEnabled) {
        const result = await api.lineNotifications.updateDraft(definition.id, {
          lineAccountId: definition.lineAccountId,
          expectedVersion: definition.version,
          name: setting.title || setting.label,
          category: definition.category,
          sourceEventType: definition.sourceEventType,
          draft: {
            ...definition.draft,
            title: setting.title,
            introText: setting.introText,
            outroText: setting.outroText,
            buttonLabel: setting.buttonLabel,
            buttonUrl: setting.buttonUrl,
            imageUrl: setting.imageUrl,
          },
        })
        if (!result.success) throw new Error('save failed')
        setDefinitions((current) => current.map((item) => item.id === result.data.id ? result.data : item))
      } else if (definition) {
        const result = enabled
          ? await api.lineNotifications.publishDefinition(definition.id, { lineAccountId: definition.lineAccountId, expectedVersion: definition.version })
          : await api.lineNotifications.stopDefinition(definition.id, { lineAccountId: definition.lineAccountId, expectedVersion: definition.version })
        if (!result.success) throw new Error('status failed')
        setDefinitions((current) => current.map((item) => item.id === result.data.id ? result.data : item))
      } else {
        await api.ecCommerce.updateSetting(setting.eventType, {
          isEnabled: enabled, title: setting.title, introText: setting.introText, outroText: setting.outroText,
          buttonLabel: setting.buttonLabel, buttonUrl: setting.buttonUrl, imageUrl: setting.imageUrl,
        })
      }
      update(setting.eventType, { isEnabled: enabled })
      setNotice({ tone: 'success', text: definition && enabled === setting.isEnabled ? `${setting.label}の下書きを保存しました。` : `${setting.label}を保存しました。` })
    } catch { setNotice({ tone: 'error', text: `${setting.label}を保存できませんでした。` }) }
    finally { setBusy(null) }
  }

  const publish = async (setting: EcNotificationSetting) => {
    const definition = definitionByEvent.get(setting.eventType)
    if (!definition) return
    setBusy(setting.eventType)
    try {
      const result = await api.lineNotifications.publishDefinition(definition.id, {
        lineAccountId: definition.lineAccountId,
        expectedVersion: definition.version,
      })
      if (!result.success) throw new Error('publish failed')
      setDefinitions((current) => current.map((item) => item.id === result.data.id ? result.data : item))
      update(setting.eventType, { isEnabled: true })
      setNotice({ tone: 'success', text: `${setting.label}を公開しました。` })
    } catch { setNotice({ tone: 'error', text: `${setting.label}を公開できませんでした。下書きの内容を確認してください。` }) }
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
    {expandedSetting === null ? <MergedTabs basePath="/line-notifications" tabs={tabsWithCounts} active={tab} defaultKey="customer" /> : null}
    {tab === 'failures' ? <NotificationRunList lineAccountId={selectedAccountId} mode="failures" /> : null}
    {tab === 'history' ? <NotificationRunList lineAccountId={selectedAccountId} mode="history" /> : null}
    {tab === 'operator' ? <OperatorNotificationRules lineAccountId={selectedAccountId} /> : null}
    {tab === 'customer' && expandedSetting ? <CustomerNotificationEditor
      setting={expandedSetting}
      definition={definitionByEvent.get(expandedSetting.eventType) ?? null}
      busy={busy === expandedSetting.eventType}
      onChange={(patch) => update(expandedSetting.eventType, patch)}
      onClose={() => setExpanded(null)}
      onPublish={() => void publish(expandedSetting)}
      onSave={() => void save(expandedSetting)}
      onTestSend={() => void testSend(expandedSetting)}
    /> : null}
    {tab === 'customer' && !expandedSetting ? <main
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
      <div className="grid w-full max-w-[48rem] grid-cols-2 gap-2 lg:grid-cols-4" aria-label="お知らせの絞り込み">
        {customerFilters.map(([value, label]) => <button key={value} type="button" onClick={() => { setFilter(value); setCustomerPage(1) }} className={`${styles.category} ${filter === value ? styles.categoryCurrent : ''}`}><span>{label}</span><span className={styles.categoryCount}>{loadState === 'ready' ? filterCount(value) : '—'}</span></button>)}
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
          <span>お知らせ</span><span>いつ送るか</span><span>今日</span><span>この30日</span><span>LINE上で表示</span><span>操作</span>
        </div>
        {visiblePage.map((setting) => <article key={setting.eventType} className="border-b border-hairline last:border-b-0">
          <div className="line-notification-v6-row">
            <div className="min-w-0">
              <h2 className="truncate font-bold text-ink" title={setting.title?.trim() || setting.label}>{setting.title?.trim() || setting.label}</h2>
              <p className="mt-0.5 truncate text-xs text-ink-faint" title={triggerLabel(setting)}>{categoryLabel(setting.category)}・{triggerLabel(setting)}</p>
              <p className="mt-0.5 truncate text-xs text-ink-faint">{formatUpdatedAt(setting.updatedAt)}</p>
            </div>
            <span className="text-sm text-ink-secondary">{timingLabel(setting)}</span>
            <span className="text-sm tabular-nums text-ink-secondary">{overview?.byType.find((item) => item.eventType === setting.eventType)?.count ?? '—'}通</span>
            <span className="text-sm tabular-nums text-ink-secondary">{metricByEvent.get(setting.eventType)?.accepted.value ?? '—'}通</span>
            <span className="text-sm text-ink-faint">{(() => {
              const displayed = metricByEvent.get(setting.eventType)?.displayed
              if (!displayed || displayed.value === null) return displayed?.state === 'pending' ? '集計待ち' : '— 未取得'
              return `${displayed.value}人`
            })()}</span>
            <div className="flex items-center justify-end gap-2"><Toggle setting={setting} busy={busy === setting.eventType} onToggle={() => void save(setting, !setting.isEnabled)} /><span className={`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${setting.isEnabled ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{setting.isEnabled ? '出している' : '止めている'}</span><button type="button" onClick={() => setExpanded(expanded === setting.eventType ? null : setting.eventType)} className="line-notification-v6-row-action">{expanded === setting.eventType ? '編集を閉じる' : '内容を編集'}</button></div>
          </div>
        </article>)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
          <p className="text-xs text-ink-faint">お知らせの種類 {settings.length}つのうち {visiblePage.length}つを表示</p>
          <Pagination page={customerPage} pageCount={customerPageCount} onPageChange={setCustomerPage} ariaLabel="お知らせのページ送り" />
        </div>
        </>}
    </section>
    </main> : null}
  </>
}
