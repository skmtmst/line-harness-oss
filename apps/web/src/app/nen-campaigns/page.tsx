'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type NenCampaignSetting,
  type NenColumn,
  type NenColumnMetrics,
  type NenDeliveryDetail,
  type NenDeliveryList,
  type NenFlowMetrics,
} from '@/lib/api'
import { NenOverview, type ColumnDeliveryPlan, type FriendOption, type NenCoupon, type NenKpis, type NenTab } from './nen-overview'
import { defaultScheduleLocal, jstMonthRange } from './nen-period'

type Notice = { tone: 'success' | 'error'; text: string }

const TABS: NenTab[] = ['auto', 'columns', 'history', 'paused']
const EMPTY_ERRORS: Record<NenTab, string> = { auto: '', columns: '', history: '', paused: '' }

function isTab(value: string | null): value is NenTab {
  return value !== null && (TABS as string[]).includes(value)
}

/**
 * NEN配信。★V6 37-6（`z4q1K`）／37-6-A（`u66A0`）。
 *
 * 数値カード（今月・先月・開封・注文・届かなかった）は月の範囲で実口から取る。
 * タブごとに必要なものだけ取り、失敗はそのタブの帯で示す（点検 #512 の中3）。
 */
export default function NenCampaignsPage() {
  usePageTitle('NEN配信')
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<NenTab>('auto')
  const [settings, setSettings] = useState<NenCampaignSetting[]>([])
  const [columns, setColumns] = useState<NenColumn[]>([])
  const [friends, setFriends] = useState<FriendOption[]>([])
  const [kpis, setKpis] = useState<NenKpis | null>(null)
  const [flowMetrics, setFlowMetrics] = useState<NenFlowMetrics | null>(null)
  const [columnMetrics, setColumnMetrics] = useState<NenColumnMetrics | null>(null)
  const [deliveryList, setDeliveryList] = useState<NenDeliveryList | null>(null)
  const [deliveryDetail, setDeliveryDetail] = useState<NenDeliveryDetail | null>(null)
  const [coupon, setCoupon] = useState<NenCoupon>({ isEnabled: true, codePrefix: 'NENBDAY', benefitLabel: 'お誕生日月限定クーポン', discountAmount: 500, validityDays: 31, leapYearPolicy: 'feb28' })
  const [couponOpen, setCouponOpen] = useState(false)
  const [savingCoupon, setSavingCoupon] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [previewCampaignKey, setPreviewCampaignKey] = useState<string | null>(null)
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null)
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [plan, setPlan] = useState<ColumnDeliveryPlan>(() => ({ when: 'now', scheduledAt: defaultScheduleLocal(new Date()) }))
  const [introDraft, setIntroDraft] = useState('')
  const [savingColumnId, setSavingColumnId] = useState<string | null>(null)
  const [testFriendId, setTestFriendId] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [tabErrors, setTabErrors] = useState<Record<NenTab, string>>(EMPTY_ERRORS)
  const loadSequence = useRef(0)
  const loadedTabs = useRef<Set<NenTab>>(new Set())
  const tabRef = useRef<NenTab>(tab)
  tabRef.current = tab

  /*
    数値カード帯はどのタブでも同じ4枚（★V6 37-6）。今月と先月を月の範囲で取る。
    自動配信・停止中・コラムは同じ取得で足りる。送った履歴だけ別に取る。
  */
  const loadTab = useCallback(async (next: NenTab) => {
    const sequence = ++loadSequence.current
    setLoading(true)
    if (!selectedAccountId) {
      setSettings([]); setColumns([]); setKpis(null)
      setFlowMetrics(null); setColumnMetrics(null); setDeliveryList(null); setDeliveryDetail(null)
      setTabErrors(EMPTY_ERRORS)
      loadedTabs.current.clear()
      setLoading(false); return
    }
    const fail = (message: string) => {
      if (sequence !== loadSequence.current) return
      setTabErrors((current) => ({ ...current, [next]: message }))
      setLoading(false)
    }
    const done = () => {
      if (sequence !== loadSequence.current) return
      setTabErrors((current) => ({ ...current, [next]: '' }))
      loadedTabs.current.add(next)
      setLoading(false)
    }
    try {
      if (next === 'history') {
        const deliveryRes = await api.nenCampaigns.deliveries(selectedAccountId, { limit: 20 })
        if (sequence !== loadSequence.current) return
        if (!deliveryRes.success) return fail('送った履歴を読み込めませんでした。')
        setDeliveryList(deliveryRes.data); done()
        return
      }
      const now = new Date()
      const thisMonth = jstMonthRange(now)
      const lastMonth = jstMonthRange(now, -1)
      const [settingRes, columnRes, flowRes, columnMetricRes, thisMonthRes, lastMonthRes, couponRes] = await Promise.all([
        api.nenCampaigns.settings(selectedAccountId),
        api.nenCampaigns.columns(selectedAccountId),
        api.nenCampaigns.flowMetrics(selectedAccountId, { from: thisMonth.from, to: thisMonth.to }),
        api.nenCampaigns.columnMetrics(selectedAccountId, { from: thisMonth.from, to: thisMonth.to }),
        api.nenCampaigns.deliveries(selectedAccountId, { from: thisMonth.from, to: thisMonth.to, limit: 1 }),
        api.nenCampaigns.deliveries(selectedAccountId, { from: lastMonth.from, to: lastMonth.to, limit: 1 }),
        api.nenCampaigns.birthdayCoupon(selectedAccountId),
      ])
      if (sequence !== loadSequence.current) return
      if (!settingRes.success || !columnRes.success || !flowRes.success || !columnMetricRes.success || !thisMonthRes.success || !lastMonthRes.success) {
        return fail(next === 'columns' ? 'コラムの情報を読み込めませんでした。' : '自動配信の情報を読み込めませんでした。')
      }
      setSettings(settingRes.data); setColumns(columnRes.data)
      setFlowMetrics(flowRes.data); setColumnMetrics(columnMetricRes.data)
      if (couponRes.success) setCoupon(couponRes.data)
      const openable = columnMetricRes.data.columns.filter((column) => column.articleOpened.state === 'available' && column.sent > 0)
      const opened = openable.reduce((sum, column) => sum + (column.articleOpened.value ?? 0), 0)
      const sentColumns = openable.reduce((sum, column) => sum + column.sent, 0)
      const unmet = thisMonthRes.data.summary.unmetReasons ?? {}
      setKpis({
        monthLabel: thisMonth.label,
        sentThisMonth: thisMonthRes.data.summary.sent,
        sentLastMonth: lastMonthRes.data.summary.sent,
        openRate: sentColumns > 0 ? Math.round((opened / sentColumns) * 100) : null,
        orders: flowRes.data.summary.associatedConversions,
        orderAmount: flowRes.data.summary.associatedConversionAmount,
        undelivered: thisMonthRes.data.summary.failed,
        blocked: unmet.blocked ?? 0,
        unfollowed: unmet.unfollowed ?? 0,
      })
      // 数値カードは全タブで共通なので、自動配信・停止中・コラムの3つをまとめて読み込み済みにする。
      for (const shared of ['auto', 'columns', 'paused'] as NenTab[]) loadedTabs.current.add(shared)
      setTabErrors((current) => ({ ...current, auto: '', columns: '', paused: '' }))
      done()
    } catch { fail('情報を読み込めませんでした。通信を確認してください。') }
  }, [selectedAccountId])

  const loadTabRef = useRef(loadTab)
  loadTabRef.current = loadTab
  useEffect(() => {
    loadedTabs.current.clear()
    setSelectedColumnId(null)
    void loadTab(tabRef.current)
  }, [loadTab])
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (isTab(requested) && requested !== 'auto') {
      setTab(requested)
      void loadTabRef.current(requested)
    }
    // 初回だけURLの指定タブを開く。loadTabはref経由で最新のものを使う。
  }, [])
  useEffect(() => {
    setFriends([]); setTestFriendId('')
    if (!selectedAccountId) return
    let cancelled = false
    void Promise.allSettled([
      api.friends.list({ accountId: selectedAccountId, limit: 100, includeTags: false }),
      api.accountSettings.getTestRecipientLoginUsers(selectedAccountId),
    ]).then(([friendResult, loginUserResult]) => {
      if (cancelled || friendResult.status !== 'fulfilled' || !friendResult.value.success) return
      const loginUsers = loginUserResult.status === 'fulfilled' && loginUserResult.value.success ? loginUserResult.value.data.filter((candidate) => candidate.sameAccount).map((candidate) => ({ id: candidate.id, displayName: candidate.staffName })) : []
      const accountFriends = friendResult.value.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      const list = [...new Map([...loginUsers, ...accountFriends].map((friend) => [friend.id, friend])).values()]
      setFriends(list); setTestFriendId((current) => list.some((friend) => friend.id === current) ? current : list[0]?.id || '')
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  // コラムを選ぶと、紹介文の下書きと「送る相手」の人数をそのコラムに合わせる。
  const selectedColumn = columns.find((column) => column.id === selectedColumnId) ?? null
  useEffect(() => {
    setIntroDraft(selectedColumn?.introText ?? '')
    setAudienceCount(null)
    if (!selectedAccountId || !selectedColumn) return
    let cancelled = false
    api.nenCampaigns.columnAudience(selectedAccountId, selectedColumn.targetMode, selectedColumn.targetTagId)
      .then((result) => { if (!cancelled && result.success) setAudienceCount(result.data.count) })
      .catch(() => undefined)
    return () => { cancelled = true }
    // 選び直したときだけ取り直す（同じコラムの一覧再読込では人数を取り直さない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, selectedColumn?.id, selectedColumn?.targetMode, selectedColumn?.targetTagId])

  const updateDraft = (key: string, patch: Partial<NenCampaignSetting>) => setSettings((current) => current.map((item) => item.campaignKey === key ? { ...item, ...patch } : item))
  // 停止・再開だけは専用の口を使い、本文などは送り直さない。保存済み本文が
  // 上限を超えていても停止は必ずできる必要がある（#659差し戻し2点目）。
  const toggleSetting = async (setting: NenCampaignSetting) => {
    if (!selectedAccountId) return
    const nextEnabled = !setting.isEnabled
    setSaving(setting.campaignKey); setNotice(null)
    try {
      await api.nenCampaigns.setEnabled(selectedAccountId, setting.campaignKey, nextEnabled)
      updateDraft(setting.campaignKey, { isEnabled: nextEnabled })
      setNotice({ tone: 'success', text: `${setting.label}を${nextEnabled ? '動かしました' : '止めました'}。` })
    } catch { setNotice({ tone: 'error', text: `${setting.label}を切り替えられませんでした。` }) }
    finally { setSaving(null) }
  }
  const testSend = async (setting: NenCampaignSetting) => {
    if (!selectedAccountId || !testFriendId) { setNotice({ tone: 'error', text: 'テスト送信先を選択してください。' }); return }
    setTesting(setting.campaignKey)
    try { await api.nenCampaigns.testSend({ campaignKey: setting.campaignKey, accountId: selectedAccountId, friendId: testFriendId }); setNotice({ tone: 'success', text: `${setting.label}をテスト送信しました。` }) }
    catch { setNotice({ tone: 'error', text: 'テスト送信できませんでした。' }) } finally { setTesting(null) }
  }
  const deliverColumn = async (column: NenColumn, scheduledAt?: string) => {
    if (!selectedAccountId) return
    try {
      const result = await api.nenCampaigns.deliverColumn(column.id, { accountId: selectedAccountId, scheduledAt })
      if (!result.success) throw new Error(result.error)
      setNotice({ tone: 'success', text: scheduledAt ? `「${column.title}」を${result.data.queued}人分 予約しました。` : `「${column.title}」を${result.data.queued}人分 配信待ちに入れました。` })
      await loadTab('columns')
    } catch { setNotice({ tone: 'error', text: 'コラムを配信予約できませんでした。コラムの配信が停止中でないか確認してください。' }) }
  }
  const saveColumnMessage = async (column: NenColumn) => {
    if (!selectedAccountId || !introDraft.trim()) { setNotice({ tone: 'error', text: '紹介文を入力してください。' }); return }
    setSavingColumnId(column.id)
    try {
      await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, introDraft)
      setColumns((current) => current.map((item) => item.id === column.id ? { ...item, introText: introDraft } : item))
      setNotice({ tone: 'success', text: `「${column.title}」の紹介文を保存しました。` })
    } catch { setNotice({ tone: 'error', text: 'コラムの紹介文を保存できませんでした。' }) } finally { setSavingColumnId(null) }
  }
  /*
    ★V6 37-6-A「ECのコラムを取り込む」。EC で保存されたコラムは Webhook で自動的に届く。
    ここでは、宛先（LINEアカウント）が決まらずに未割り当てのまま残っている分を、
    選択中のアカウントへ割り当てて一覧に出す。
  */
  const [importing, setImporting] = useState(false)
  const importColumns = async () => {
    if (!selectedAccountId || importing) return
    setImporting(true); setNotice(null)
    try {
      const result = await api.nenCampaigns.importColumns(selectedAccountId)
      if (!result.success) throw new Error(result.error)
      setNotice({ tone: 'success', text: result.data.imported > 0
        ? `ECのコラムを${result.data.imported}本 取り込みました。`
        : '新しいコラムはありません。ECでコラムを保存すると自動でここに届きます。' })
      await loadTab('columns')
    } catch { setNotice({ tone: 'error', text: 'ECのコラムを取り込めませんでした。通信の状態を確認して、もう一度お試しください。' }) }
    finally { setImporting(false) }
  }
  const duplicateColumn = async (column: NenColumn) => {
    if (!selectedAccountId) return
    try { const result = await api.nenCampaigns.duplicateColumn(column.id, selectedAccountId); if (!result.success) throw new Error(); setNotice({ tone: 'success', text: `「${column.title}」を下書きへ複製しました。` }); await loadTab('columns'); setSelectedColumnId(result.data.id) }
    catch { setNotice({ tone: 'error', text: 'コラムを複製できませんでした。' }) }
  }
  const testColumn = async (column: NenColumn) => {
    if (!selectedAccountId || !testFriendId) { setNotice({ tone: 'error', text: 'テスト送信先を選択してください。' }); return }
    try { await api.nenCampaigns.testColumn(column.id, selectedAccountId, testFriendId); setNotice({ tone: 'success', text: `「${column.title}」をテスト送信しました。` }) }
    catch { setNotice({ tone: 'error', text: 'コラムをテスト送信できませんでした。' }) }
  }
  const sendPendingNow = async () => {
    if (!selectedAccountId) return
    /*
      送る件数は一覧の窓付き集計(summary.pending)ではなく、口と同じ決めごとの
      overview.jobs.pending(未来ぶん)を使う(点検 #512 の中2)。窓が違う数を
      送ると、変わっていないのに409で失敗する。
    */
    try {
      const overviewRes = await api.nenCampaigns.overview(selectedAccountId)
      if (!overviewRes.success) throw new Error()
      const result = await api.nenCampaigns.sendPendingNow(selectedAccountId, overviewRes.data.jobs.pending)
      if (!result.success) throw new Error()
      setNotice({ tone: 'success', text: `${result.data.queued}件を今すぐ送る待ち行列へ移しました。` }); await loadTab('history')
    }
    catch { setNotice({ tone: 'error', text: '待っている配信の件数が変わりました。読み直して確認してください。' }) }
  }
  const saveCoupon = async () => {
    if (!selectedAccountId || savingCoupon) return
    // 空欄は 0 になるので、汎用エラー(400)になる前に具体的な直し方を出す。
    if (!Number.isInteger(coupon.discountAmount) || coupon.discountAmount < 1 || coupon.discountAmount > 100000) {
      setNotice({ tone: 'error', text: '割引の額は1〜100,000円の整数で入力してください。' })
      return
    }
    if (!Number.isInteger(coupon.validityDays) || coupon.validityDays < 1 || coupon.validityDays > 365) {
      setNotice({ tone: 'error', text: '使える日数は1〜365日の整数で入力してください。' })
      return
    }
    if (!/^[A-Z0-9-]{3,10}$/.test(coupon.codePrefix)) {
      setNotice({ tone: 'error', text: 'クーポンの頭の文字は半角大文字・数字・-で3〜10文字にしてください。' })
      return
    }
    setSavingCoupon(true)
    try { await api.nenCampaigns.updateBirthdayCoupon(selectedAccountId, coupon); setNotice({ tone: 'success', text: 'お誕生日クーポン設定を保存しました。' }); setCouponOpen(false) }
    catch { setNotice({ tone: 'error', text: 'クーポン設定を保存できませんでした。' }) }
    finally { setSavingCoupon(false) }
  }
  const showDelivery = async (id: string) => {
    if (!selectedAccountId) return
    if (deliveryDetail?.id === id) { setDeliveryDetail(null); return }
    try {
      const result = await api.nenCampaigns.delivery(id, selectedAccountId)
      if (!result.success) throw new Error()
      setDeliveryDetail(result.data)
    } catch { setNotice({ tone: 'error', text: '配信時の内容を表示できませんでした。' }) }
  }
  const changeDeliveryView = async (status?: string, cursor?: string) => {
    if (!selectedAccountId) return
    try {
      const result = await api.nenCampaigns.deliveries(selectedAccountId, { limit: 20, status, cursor })
      if (!result.success) throw new Error()
      setDeliveryList(result.data); setDeliveryDetail(null)
    } catch { setNotice({ tone: 'error', text: '送った履歴を更新できませんでした。' }) }
  }
  const retryDelivery = async (id: string, expectedVersion: number, reason: string) => {
    if (!selectedAccountId || !reason.trim()) { setNotice({ tone: 'error', text: '再送する理由を入力してください。' }); return }
    try {
      const result = await api.nenCampaigns.retryDelivery(id, { lineAccountId: selectedAccountId, expectedVersion, reason: reason.trim() })
      if (!result.success) throw new Error()
      setNotice({ tone: 'success', text: '配信を再送待ちへ戻しました。' }); setDeliveryDetail(null); await loadTab('history')
    } catch { setNotice({ tone: 'error', text: '配信を再送待ちへ戻せませんでした。状態を更新して確認してください。' }) }
  }
  const changeTab = (next: NenTab) => {
    setTab(next)
    setNotice(null)
    window.history.replaceState(window.history.state, '', next === 'auto' ? '/nen-campaigns' : `/nen-campaigns?tab=${next}`)
    if (!loadedTabs.current.has(next)) void loadTab(next)
  }

  if (loading && loadedTabs.current.size === 0) return <main className="p-6"><ListState kind="loading" /></main>

  /*
    ヘッダー操作。★V6 37-6 の「配信を追加」は、自動配信の種類が実キー固定（追加口が無い）
    ため置かない。コラムは ★V6 37-6-A どおり「ECのコラムを取り込む」（未割り当て分の割り当て）。
  */
  const headerAction = tab === 'columns' ? <Button type="button" variant="primary" disabled={importing || !selectedAccountId} onClick={() => void importColumns()}>{importing ? '取り込んでいます…' : 'ECのコラムを取り込む'}</Button>
    : tab === 'history' ? <Button type="button" disabled={!deliveryList?.summary.pending} onClick={() => void sendPendingNow()}>待っているものを今すぐ送る</Button>
      : null

  return (
    <>
      {tabErrors[tab] ? (
        <div className="mx-auto w-full px-4 pt-4 sm:px-6" style={{ maxWidth: 1600 }}>
          <NoteBar
            tone="danger"
            action={<Button type="button" onClick={() => void loadTab(tab)}>もう一度読み込む</Button>}
          >
            {tabErrors[tab]}
          </NoteBar>
        </div>
      ) : null}
      <NenOverview
        topAction={headerAction}
        tab={tab} onTabChange={changeTab} settings={settings} columns={columns} kpis={kpis}
        flowMetrics={flowMetrics} columnMetrics={columnMetrics} deliveryList={deliveryList} deliveryDetail={deliveryDetail}
        friends={friends} testFriendId={testFriendId} onTestFriendChange={setTestFriendId}
        loading={loading} notice={notice}
        saving={saving} testing={testing}
        previewCampaignKey={previewCampaignKey} onPreviewCampaign={setPreviewCampaignKey}
        onToggleSetting={(setting) => void toggleSetting(setting)} onTestSend={(setting) => void testSend(setting)}
        coupon={coupon} couponOpen={couponOpen} onCouponOpenChange={setCouponOpen} onCouponChange={setCoupon} onSaveCoupon={() => void saveCoupon()} savingCoupon={savingCoupon}
        selectedColumnId={selectedColumnId} onSelectColumn={setSelectedColumnId} audienceCount={audienceCount}
        plan={plan} onPlanChange={setPlan}
        introDraft={introDraft} onIntroChange={setIntroDraft} onSaveIntro={(column) => void saveColumnMessage(column)} savingColumnId={savingColumnId}
        onDeliverColumn={(column, scheduledAt) => void deliverColumn(column, scheduledAt)}
        onDuplicateColumn={(column) => void duplicateColumn(column)} onTestColumn={(column) => void testColumn(column)}
        onShowDelivery={(id) => void showDelivery(id)} onRetryDelivery={(id, version, reason) => void retryDelivery(id, version, reason)}
        onChangeDeliveryView={(status, cursor) => void changeDeliveryView(status, cursor)}
      />
    </>
  )
}
