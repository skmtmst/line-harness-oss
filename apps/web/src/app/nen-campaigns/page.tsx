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
  type NenPetMetrics,
  type NenPetProfile,
} from '@/lib/api'
import { NenOverview, type NenCoupon, type NenTab } from './nen-overview'

type Notice = { tone: 'success' | 'error'; text: string }
type FriendOption = { id: string; displayName: string | null }
function ColumnLinePreview({ column, onClose }: { column: NenColumn; onClose: () => void }) {
  return (
    <section id={`column-preview-${column.id}`} className="overflow-hidden rounded-v6-card border border-hairline bg-canvas lg:max-w-[920px]">
      <div className="flex min-h-[52px] items-center justify-between gap-3 bg-[#3f3f3f] px-4 py-3 text-white">
        <div><p className="text-sm font-bold">LINEプレビュー</p><p className="mt-0.5 text-xs text-gray-300">実際のトーク画面に近い見え方です</p></div>
        <Button onClick={onClose}>プレビューを隠す</Button>
      </div>
      <div className="min-h-[220px] bg-[#8facd8] p-5"><div className="mx-auto max-w-[480px] rounded-v6-card rounded-tl-[4px] bg-white p-4 shadow-v6-card"><p className="whitespace-pre-wrap text-sm leading-[1.65] text-ink">{column.introText}</p><div className="mt-3 border-t border-hairline pt-3"><h4 className="font-bold tracking-[0.01em] text-ink">{column.title}</h4><p className="mt-2 text-sm leading-6 text-ink-secondary">{column.excerpt}</p><p className="mt-3 min-h-[36px] rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-white">コラムを読む</p></div></div></div>
    </section>
  )
}

function CampaignLinePreview({ setting, onClose }: { setting: NenCampaignSetting; onClose: () => void }) {
  const samples: Record<string, string> = { '{{pet_name}}': 'ココ', '{{coupon_code}}': 'NENBDAY-1234', '{{coupon_expiry}}': '2026-09-30' }
  const replaceSample = (value: string) => Object.entries(samples).reduce((result, [from, to]) => result.replaceAll(from, to), value)
  return (
    <section id={`campaign-preview-${setting.campaignKey}`} className="overflow-hidden rounded-v6-card border border-hairline bg-canvas lg:max-w-[920px]">
      <div className="flex min-h-[52px] items-center justify-between gap-3 bg-[#3f3f3f] px-4 py-3 text-white"><div><p className="text-sm font-bold">{setting.label}のLINEプレビュー</p><p className="mt-0.5 text-xs text-gray-300">お客様ごとの情報は見本に置き換えています</p></div><Button onClick={onClose}>プレビューを隠す</Button></div>
      <div className="min-h-[220px] bg-[#8facd8] p-5"><div className="mx-auto min-h-[240px] max-w-[480px] rounded-v6-card rounded-tl-[4px] bg-white p-4 shadow-v6-card"><h4 className="font-bold leading-6 tracking-[0.01em] text-ink">{replaceSample(setting.title)}</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-[1.65] text-ink-secondary">{replaceSample(setting.bodyText)}</p>{setting.buttonLabel ? <p className="mt-3 min-h-[36px] rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-white">{setting.buttonLabel}</p> : null}</div></div>
    </section>
  )
}

export default function NenCampaignsPage() {
  usePageTitle('NEN配信')
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<NenTab>('flow')
  const [settings, setSettings] = useState<NenCampaignSetting[]>([])
  const [columns, setColumns] = useState<NenColumn[]>([])
  const [pets, setPets] = useState<NenPetProfile[]>([])
  const [friends, setFriends] = useState<FriendOption[]>([])
  const [flowMetrics, setFlowMetrics] = useState<NenFlowMetrics | null>(null)
  const [columnMetrics, setColumnMetrics] = useState<NenColumnMetrics | null>(null)
  const [petMetrics, setPetMetrics] = useState<NenPetMetrics | null>(null)
  const [deliveryList, setDeliveryList] = useState<NenDeliveryList | null>(null)
  const [deliveryDetail, setDeliveryDetail] = useState<NenDeliveryDetail | null>(null)
  const [coupon, setCoupon] = useState<NenCoupon>({ isEnabled: true, codePrefix: 'NENBDAY', benefitLabel: 'お誕生日月限定クーポン', discountAmount: 500, validityDays: 31 })
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [previewCampaignKey, setPreviewCampaignKey] = useState<string | null>(null)
  const [previewColumnId, setPreviewColumnId] = useState<string | null>(null)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [savingColumnId, setSavingColumnId] = useState<string | null>(null)
  const [testFriendId, setTestFriendId] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [tabErrors, setTabErrors] = useState<Record<NenTab, string>>({ flow: '', columns: '', pets: '', history: '' })
  const [petDraft, setPetDraft] = useState({ friendId: '', name: '', animalType: 'dog', gender: 'unknown', birthday: '' })
  const loadSequence = useRef(0)
  const loadedTabs = useRef<Set<NenTab>>(new Set())
  const tabRef = useRef<NenTab>(tab)
  tabRef.current = tab

  /*
    開いたタブのぶんだけ取る(点検 #512 の中3)。8件同時取得だと遅く、
    1件の失敗で画面全体がエラーになる。失敗はそのタブだけの帯で示し、
    操作後は関係するタブだけ読み直す。
  */
  const loadTab = useCallback(async (next: NenTab) => {
    const sequence = ++loadSequence.current
    setLoading(true)
    if (!selectedAccountId) {
      setSettings([]); setColumns([]); setPets([])
      setFlowMetrics(null); setColumnMetrics(null); setPetMetrics(null); setDeliveryList(null); setDeliveryDetail(null)
      setTabErrors({ flow: '', columns: '', pets: '', history: '' })
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
      if (next === 'flow') {
        const [settingRes, flowRes] = await Promise.all([
          api.nenCampaigns.settings(selectedAccountId), api.nenCampaigns.flowMetrics(selectedAccountId),
        ])
        if (sequence !== loadSequence.current) return
        if (!settingRes.success || !flowRes.success) return fail('フォロー配信の情報を読み込めませんでした。')
        setSettings(settingRes.data); setFlowMetrics(flowRes.data); done()
      } else if (next === 'columns') {
        const [columnRes, columnMetricRes] = await Promise.all([
          api.nenCampaigns.columns(selectedAccountId), api.nenCampaigns.columnMetrics(selectedAccountId, 90),
        ])
        if (sequence !== loadSequence.current) return
        if (!columnRes.success || !columnMetricRes.success) return fail('コラムの情報を読み込めませんでした。')
        setColumns(columnRes.data); setColumnMetrics(columnMetricRes.data); done()
      } else if (next === 'pets') {
        const [petRes, petMetricRes, couponRes] = await Promise.all([
          api.nenCampaigns.pets(selectedAccountId),
          api.nenCampaigns.petMetrics(selectedAccountId), api.nenCampaigns.birthdayCoupon(selectedAccountId),
        ])
        if (sequence !== loadSequence.current) return
        if (!petRes.success || !petMetricRes.success || !couponRes.success) return fail('ペットの情報を読み込めませんでした。')
        setPets(petRes.data); setPetMetrics(petMetricRes.data); setCoupon(couponRes.data); done()
      } else {
        const deliveryRes = await api.nenCampaigns.deliveries(selectedAccountId, { limit: 20 })
        if (sequence !== loadSequence.current) return
        if (!deliveryRes.success) return fail('配信履歴を読み込めませんでした。')
        setDeliveryList(deliveryRes.data); done()
      }
    } catch { fail('情報を読み込めませんでした。通信を確認してください。') }
  }, [selectedAccountId])

  const loadTabRef = useRef(loadTab)
  loadTabRef.current = loadTab
  useEffect(() => {
    loadedTabs.current.clear()
    void loadTab(tabRef.current)
  }, [loadTab])
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested === 'columns' || requested === 'pets' || requested === 'history') {
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
      setFriends(list); setTestFriendId((current) => list.some((friend) => friend.id === current) ? current : list[0]?.id || ''); setPetDraft((current) => ({ ...current, friendId: current.friendId || list[0]?.id || '' }))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const updateDraft = (key: string, patch: Partial<NenCampaignSetting>) => setSettings((current) => current.map((item) => item.campaignKey === key ? { ...item, ...patch } : item))
  const saveSetting = async (setting: NenCampaignSetting, override?: Partial<NenCampaignSetting>) => {
    if (!selectedAccountId) return
    const next = { ...setting, ...override }; setSaving(setting.campaignKey); setNotice(null)
    try { await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, { isEnabled: next.isEnabled, title: next.title, bodyText: next.bodyText, delayDays: next.delayDays, deliveryTime: next.deliveryTime, buttonLabel: next.buttonLabel, buttonUrl: next.buttonUrl, imageUrl: next.imageUrl, afterActions: next.afterActions }); updateDraft(setting.campaignKey, next); setNotice({ tone: 'success', text: `${setting.label}の設定を保存しました。` }) }
    catch { setNotice({ tone: 'error', text: `${setting.label}を保存できませんでした。` }) } finally { setSaving(null) }
  }
  const testSend = async (setting: NenCampaignSetting) => {
    if (!selectedAccountId || !testFriendId) { setNotice({ tone: 'error', text: 'テスト送信先を選択してください。' }); return }
    setTesting(setting.campaignKey)
    try { await api.nenCampaigns.testSend({ campaignKey: setting.campaignKey, accountId: selectedAccountId, friendId: testFriendId }); setNotice({ tone: 'success', text: `${setting.label}をテスト送信しました。` }) }
    catch { setNotice({ tone: 'error', text: 'テスト送信できませんでした。' }) } finally { setTesting(null) }
  }
  const deliverColumn = async (column: NenColumn, scheduledAt?: string) => {
    if (!selectedAccountId) return
    try { const result = await api.nenCampaigns.deliverColumn(column.id, { accountId: selectedAccountId, scheduledAt }); if (!result.success) throw new Error(result.error); setNotice({ tone: 'success', text: `${result.data.queued}人分のコラム配信を予約しました。` }); await loadTab('columns') }
    catch { setNotice({ tone: 'error', text: 'コラムを配信予約できませんでした。' }) }
  }
  const saveColumnMessage = async (column: NenColumn) => {
    if (!selectedAccountId || !column.introText.trim()) { setNotice({ tone: 'error', text: '紹介文を入力してください。' }); return }
    setSavingColumnId(column.id)
    try { await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, column.introText); setNotice({ tone: 'success', text: `「${column.title}」の配信文を保存しました。` }); setEditingColumnId(null) }
    catch { setNotice({ tone: 'error', text: 'コラムの配信文を保存できませんでした。' }) } finally { setSavingColumnId(null) }
  }
  const duplicateColumn = async (column: NenColumn) => {
    if (!selectedAccountId) return
    try { const result = await api.nenCampaigns.duplicateColumn(column.id, selectedAccountId); if (!result.success) throw new Error(); setNotice({ tone: 'success', text: `「${column.title}」を下書きへ複製しました。` }); await loadTab('columns') }
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
  const addPet = async () => {
    if (!selectedAccountId || !petDraft.friendId || !petDraft.name.trim()) { setNotice({ tone: 'error', text: 'LINEユーザーとペットのお名前を入力してください。' }); return }
    try { await api.nenCampaigns.createPet(selectedAccountId, { ...petDraft, birthday: petDraft.birthday || undefined }); setPetDraft((current) => ({ ...current, name: '', birthday: '', gender: 'unknown' })); setNotice({ tone: 'success', text: 'ペット情報を登録しました。' }); await loadTab('pets') }
    catch { setNotice({ tone: 'error', text: 'ペット情報を登録できませんでした。' }) }
  }
  const deletePet = async (pet: NenPetProfile) => {
    if (!selectedAccountId) return
    try { await api.nenCampaigns.deletePet(selectedAccountId, pet.id); setNotice({ tone: 'success', text: `${pet.name}の登録を外しました。` }); await loadTab('pets') }
    catch { setNotice({ tone: 'error', text: 'ペット情報を外せませんでした。' }) }
  }
  const saveCoupon = async () => {
    if (!selectedAccountId) return
    try { await api.nenCampaigns.updateBirthdayCoupon(selectedAccountId, coupon); setNotice({ tone: 'success', text: 'お誕生日クーポン設定を保存しました。' }) }
    catch { setNotice({ tone: 'error', text: 'クーポン設定を保存できませんでした。' }) }
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
    } catch { setNotice({ tone: 'error', text: '配信履歴を更新できませんでした。' }) }
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
    window.history.replaceState(window.history.state, '', next === 'flow' ? '/nen-campaigns' : `/nen-campaigns?tab=${next}`)
    void loadTab(next)
  }

  if (loading && loadedTabs.current.size === 0) return <main className="p-6"><ListState kind="loading" /></main>

  const headerAction = tab === 'columns' ? <Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>
    : tab === 'pets' ? <Button href="/form-submissions" variant="primary">聞きとりフォームを開く</Button>
      : tab === 'history' ? <Button disabled={!deliveryList?.summary.pending} onClick={() => void sendPendingNow()}>待っているものを今すぐ送る</Button>
        : <Button onClick={() => document.getElementById('nen-test-send')?.scrollIntoView({ behavior: 'smooth' })}>テスト送信</Button>

  return (
    <>
      {tabErrors[tab] ? (
        <div className="mx-auto w-full px-4 pt-4 sm:px-6" style={{ maxWidth: 1600 }}>
          <NoteBar
            tone="danger"
            action={<Button onClick={() => void loadTab(tab)}>もう一度読み込む</Button>}
          >
            {tabErrors[tab]}
          </NoteBar>
        </div>
      ) : null}
      <NenOverview
        topAction={headerAction}
        tab={tab} onTabChange={changeTab} settings={settings} columns={columns} pets={pets} friends={friends} coupon={coupon}
        flowMetrics={flowMetrics} columnMetrics={columnMetrics} petMetrics={petMetrics} deliveryList={deliveryList} deliveryDetail={deliveryDetail}
        testFriendId={testFriendId} previewCampaignKey={previewCampaignKey} previewColumnId={previewColumnId} editingColumnId={editingColumnId}
        saving={saving} testing={testing} savingColumnId={savingColumnId} petDraft={petDraft} notice={notice}
        onTestFriendChange={setTestFriendId} onPreviewCampaign={setPreviewCampaignKey} onPreviewColumn={setPreviewColumnId} onEditColumn={setEditingColumnId}
        onUpdateColumn={(id, introText) => setColumns((current) => current.map((column) => column.id === id ? { ...column, introText } : column))}
        onSaveColumn={(column) => void saveColumnMessage(column)} onDeliverColumn={(column, scheduledAt) => void deliverColumn(column, scheduledAt)}
        onDuplicateColumn={(column) => void duplicateColumn(column)} onTestColumn={(column) => void testColumn(column)}
        onToggleSetting={(setting) => void saveSetting(setting, { isEnabled: !setting.isEnabled })} onTestSend={(setting) => void testSend(setting)}
        onPetDraftChange={setPetDraft} onAddPet={() => void addPet()} onDeletePet={(pet) => void deletePet(pet)} onCouponChange={setCoupon} onSaveCoupon={() => void saveCoupon()}
        onShowDelivery={(id) => void showDelivery(id)} onRetryDelivery={(id, version, reason) => void retryDelivery(id, version, reason)}
        onChangeDeliveryView={(status, cursor) => void changeDeliveryView(status, cursor)}
        renderCampaignPreview={(setting) => <CampaignLinePreview setting={setting} onClose={() => setPreviewCampaignKey(null)} />}
        renderColumnPreview={(column) => <ColumnLinePreview column={column} onClose={() => setPreviewColumnId(null)} />}
      />
    </>
  )
}
