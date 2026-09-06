'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import { api, type NenCampaignSetting, type NenColumn, type NenPetProfile } from '@/lib/api'
import { NenOverview, type NenCoupon, type NenJob, type NenTab } from './nen-overview'

type Notice = { tone: 'success' | 'error'; text: string }
type FriendOption = { id: string; displayName: string | null }
type Overview = {
  activeCampaigns: number
  jobs: { total?: number; pending: number; sent: number; failed: number }
  columns: number
  pets: number
  coupons: number
}

function ColumnLinePreview({ column, onClose }: { column: NenColumn; onClose: () => void }) {
  return (
    <section id={`column-preview-${column.id}`} className="overflow-hidden rounded-v6-card border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-3 bg-[#3f3f3f] px-4 py-3 text-white">
        <div><p className="text-sm font-bold">LINEプレビュー</p><p className="mt-0.5 text-xs text-gray-300">実際のトーク画面に近い見え方です</p></div>
        <Button onClick={onClose}>プレビューを隠す</Button>
      </div>
      <div className="bg-[#8facd8] p-5"><div className="mx-auto max-w-md rounded-v6-card bg-white p-4 shadow-v6-card"><p className="whitespace-pre-wrap text-sm leading-6 text-ink">{column.introText}</p><div className="mt-3 border-t border-hairline pt-3"><h4 className="font-bold text-ink">{column.title}</h4><p className="mt-2 text-sm leading-6 text-ink-secondary">{column.excerpt}</p><p className="mt-3 rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-white">コラムを読む</p></div></div></div>
    </section>
  )
}

function CampaignLinePreview({ setting, onClose }: { setting: NenCampaignSetting; onClose: () => void }) {
  const samples: Record<string, string> = { '{{pet_name}}': 'ココ', '{{coupon_code}}': 'NENBDAY-1234', '{{coupon_expiry}}': '2026-09-30' }
  const replaceSample = (value: string) => Object.entries(samples).reduce((result, [from, to]) => result.replaceAll(from, to), value)
  return (
    <section id={`campaign-preview-${setting.campaignKey}`} className="overflow-hidden rounded-v6-card border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-3 bg-[#3f3f3f] px-4 py-3 text-white"><div><p className="text-sm font-bold">{setting.label}のLINEプレビュー</p><p className="mt-0.5 text-xs text-gray-300">お客様ごとの情報は見本に置き換えています</p></div><Button onClick={onClose}>プレビューを隠す</Button></div>
      <div className="bg-[#8facd8] p-5"><div className="mx-auto max-w-md rounded-v6-card bg-white p-4 shadow-v6-card"><h4 className="font-bold leading-6 text-ink">{replaceSample(setting.title)}</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{replaceSample(setting.bodyText)}</p>{setting.buttonLabel ? <p className="mt-3 rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-white">{setting.buttonLabel}</p> : null}</div></div>
    </section>
  )
}

export default function NenCampaignsPage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<NenTab>('flow')
  const [settings, setSettings] = useState<NenCampaignSetting[]>([])
  const [columns, setColumns] = useState<NenColumn[]>([])
  const [pets, setPets] = useState<NenPetProfile[]>([])
  const [friends, setFriends] = useState<FriendOption[]>([])
  const [jobs, setJobs] = useState<NenJob[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
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
  const [loadError, setLoadError] = useState('')
  const [petDraft, setPetDraft] = useState({ friendId: '', name: '', animalType: 'dog', gender: 'unknown', birthday: '' })
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true); setLoadError('')
    if (!selectedAccountId) { setSettings([]); setColumns([]); setPets([]); setJobs([]); setOverview(null); setLoading(false); return }
    try {
      const [settingRes, columnRes, petRes, jobRes, overviewRes, couponRes] = await Promise.all([
        api.nenCampaigns.settings(selectedAccountId), api.nenCampaigns.columns(selectedAccountId), api.nenCampaigns.pets(selectedAccountId),
        api.nenCampaigns.jobs(selectedAccountId), api.nenCampaigns.overview(selectedAccountId), api.nenCampaigns.birthdayCoupon(selectedAccountId),
      ])
      if (sequence !== loadSequence.current) return
      if (!settingRes.success || !columnRes.success || !petRes.success || !jobRes.success || !overviewRes.success || !couponRes.success) throw new Error()
      setSettings(settingRes.data); setColumns(columnRes.data); setPets(petRes.data); setJobs(jobRes.data); setOverview(overviewRes.data); setCoupon(couponRes.data)
    } catch { if (sequence === loadSequence.current) setLoadError('フォロー配信の情報を読み込めませんでした。') }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested === 'columns' || requested === 'pets' || requested === 'history') setTab(requested)
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
    try { await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, { isEnabled: next.isEnabled, title: next.title, bodyText: next.bodyText, delayDays: next.delayDays, deliveryTime: next.deliveryTime, buttonLabel: next.buttonLabel, buttonUrl: next.buttonUrl, imageUrl: next.imageUrl }); updateDraft(setting.campaignKey, next); setNotice({ tone: 'success', text: `${setting.label}の設定を保存しました。` }) }
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
    try { const result = await api.nenCampaigns.deliverColumn(column.id, { accountId: selectedAccountId, scheduledAt }); if (!result.success) throw new Error(result.error); setNotice({ tone: 'success', text: `${result.data.queued}人分のコラム配信を予約しました。` }); await load() }
    catch { setNotice({ tone: 'error', text: 'コラムを配信予約できませんでした。' }) }
  }
  const saveColumnMessage = async (column: NenColumn) => {
    if (!selectedAccountId || !column.introText.trim()) { setNotice({ tone: 'error', text: '紹介文を入力してください。' }); return }
    setSavingColumnId(column.id)
    try { await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, column.introText); setNotice({ tone: 'success', text: `「${column.title}」の配信文を保存しました。` }); setEditingColumnId(null) }
    catch { setNotice({ tone: 'error', text: 'コラムの配信文を保存できませんでした。' }) } finally { setSavingColumnId(null) }
  }
  const addPet = async () => {
    if (!selectedAccountId || !petDraft.friendId || !petDraft.name.trim()) { setNotice({ tone: 'error', text: 'LINEユーザーとペットのお名前を入力してください。' }); return }
    try { await api.nenCampaigns.createPet(selectedAccountId, { ...petDraft, birthday: petDraft.birthday || undefined }); setPetDraft((current) => ({ ...current, name: '', birthday: '', gender: 'unknown' })); setNotice({ tone: 'success', text: 'ペット情報を登録しました。' }); await load() }
    catch { setNotice({ tone: 'error', text: 'ペット情報を登録できませんでした。' }) }
  }
  const deletePet = async (pet: NenPetProfile) => {
    if (!selectedAccountId) return
    try { await api.nenCampaigns.deletePet(selectedAccountId, pet.id); setNotice({ tone: 'success', text: `${pet.name}の登録を外しました。` }); await load() }
    catch { setNotice({ tone: 'error', text: 'ペット情報を外せませんでした。' }) }
  }
  const saveCoupon = async () => {
    if (!selectedAccountId) return
    try { await api.nenCampaigns.updateBirthdayCoupon(selectedAccountId, coupon); setNotice({ tone: 'success', text: 'お誕生日クーポン設定を保存しました。' }) }
    catch { setNotice({ tone: 'error', text: 'クーポン設定を保存できませんでした。' }) }
  }
  const changeTab = (next: NenTab) => { setTab(next); window.history.replaceState(window.history.state, '', next === 'flow' ? '/nen-campaigns' : `/nen-campaigns?tab=${next}`) }

  if (loading) return <><Header title="NEN配信" /><main className="p-6"><ListState kind="loading" /></main></>
  if (loadError) return <><Header title="NEN配信" /><main className="p-6"><ListState kind="error" description={loadError} action={<Button variant="primary" onClick={() => void load()}>フォロー配信を再読み込み</Button>} /></main></>

  const headerAction = tab === 'columns' ? <Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>
    : tab === 'pets' ? <Button href="/forms" variant="primary">聞きとりフォームを開く</Button>
      : tab === 'history' ? <Button disabled title="一括送信APIが接続されると使えます">待っているものを今すぐ送る</Button>
        : <Button onClick={() => document.getElementById('nen-test-send')?.scrollIntoView({ behavior: 'smooth' })}>テスト送信</Button>

  return (
    <>
      <div data-design="Head"><Header title="NEN配信" description="購入してくれた方へ、到着確認から記念日までの配信を管理します。" action={headerAction} /></div>
      <NenOverview
        tab={tab} onTabChange={changeTab} settings={settings} columns={columns} pets={pets} friends={friends} jobs={jobs} overview={overview} coupon={coupon}
        testFriendId={testFriendId} previewCampaignKey={previewCampaignKey} previewColumnId={previewColumnId} editingColumnId={editingColumnId}
        saving={saving} testing={testing} savingColumnId={savingColumnId} petDraft={petDraft} notice={notice}
        onTestFriendChange={setTestFriendId} onPreviewCampaign={setPreviewCampaignKey} onPreviewColumn={setPreviewColumnId} onEditColumn={setEditingColumnId}
        onUpdateColumn={(id, introText) => setColumns((current) => current.map((column) => column.id === id ? { ...column, introText } : column))}
        onSaveColumn={(column) => void saveColumnMessage(column)} onDeliverColumn={(column, scheduledAt) => void deliverColumn(column, scheduledAt)}
        onToggleSetting={(setting) => void saveSetting(setting, { isEnabled: !setting.isEnabled })} onTestSend={(setting) => void testSend(setting)}
        onPetDraftChange={setPetDraft} onAddPet={() => void addPet()} onDeletePet={(pet) => void deletePet(pet)} onCouponChange={setCoupon} onSaveCoupon={() => void saveCoupon()}
        renderCampaignPreview={(setting) => <CampaignLinePreview setting={setting} onClose={() => setPreviewCampaignKey(null)} />}
        renderColumnPreview={(column) => <ColumnLinePreview column={column} onClose={() => setPreviewColumnId(null)} />}
      />
    </>
  )
}
