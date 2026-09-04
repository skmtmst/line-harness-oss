'use client'

import SelectField from '@/components/shared/select-field'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { api, type NenCampaignSetting, type NenColumn, type NenPetProfile } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { formatCampaignTiming, formatNenJobDateTime } from './campaign-display'

type Tab = 'flow' | 'columns' | 'pets' | 'history'
type Notice = { tone: 'success' | 'error'; text: string }
type FriendOption = { id: string; displayName: string | null }

const categoryLabel: Record<NenCampaignSetting['category'], string> = {
  transactional: '購入通知', follow_up: '購入後フォロー', column: 'コンテンツ', birthday: '記念日',
}
const jobStatusLabel: Record<string, string> = {
  pending: '配信待ち', processing: '送信中', sent: '送信済み', skipped: '対象外',
  failed: '送信できませんでした', cancelled: '取り消し済み',
}
const columnDeliveryStatusLabel: Record<NenColumn['deliveryStatus'], string> = {
  draft: '下書き',
  scheduled: '予約ずみ',
  queued: '配信待ち',
  sent: '出したもの',
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function ColumnLinePreview({ column, onClose }: { column: NenColumn; onClose: () => void }) {
  return (
    <section id={`column-preview-${column.id}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm sm:col-span-2">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-[#3f3f3f] px-4 py-3 text-white">
        <div>
          <p className="text-sm font-bold">LINEプレビュー</p>
          <p className="mt-0.5 text-xs text-gray-300">実際のトーク画面に近い見え方です</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
          プレビューを隠す
        </button>
      </div>
      <div className="bg-[#8facd8] p-4 sm:p-6">
        <div className="mx-auto flex max-w-md items-start gap-2.5">
          <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/70 bg-[#075b36] text-sm font-bold text-white shadow-sm">
            然
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="mb-1 text-xs font-medium text-white/95">然-NEN-</p>
            <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm">
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{column.introText}</p>
            </div>
            <div className="overflow-hidden rounded-2xl rounded-tl-md bg-white shadow-md">
              {column.imageUrl && <img src={column.imageUrl} alt={`${column.title}のアイキャッチ`} className="aspect-[3/2] w-full object-cover" />}
              <div className="space-y-3 p-4">
                <h4 className="text-base font-bold leading-6 text-[#123f2b]">{column.title}</h4>
                <p className="text-sm leading-6 text-slate-600">{column.excerpt}</p>
              </div>
              <div className="border-t border-gray-100 p-3">
                <div className="rounded-lg bg-[#0f766e] py-2.5 text-center text-sm font-semibold text-white">コラムを読む</div>
              </div>
            </div>
            <p className="mt-1 text-right text-[10px] text-white/80">配信イメージ</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function CampaignLinePreview({ setting, onClose }: { setting: NenCampaignSetting; onClose: () => void }) {
  const isBirthday = setting.campaignKey === 'birthday_coupon'
  const isOrderConfirmed = setting.campaignKey === 'order_confirmed'
  const title = setting.title.replaceAll('{{pet_name}}', 'ココ').replaceAll('{{coupon_code}}', 'NENBDAY-1234').replaceAll('{{coupon_expiry}}', '2026-09-30')
  const body = setting.bodyText.replaceAll('{{pet_name}}', 'ココ').replaceAll('{{coupon_code}}', 'NENBDAY-1234').replaceAll('{{coupon_expiry}}', '2026-09-30')
  const automaticDetails = isBirthday
    ? ['クーポンコード：NENBDAY-1234', '有効期限：2026-09-30']
    : [
        '注文番号：NEN-000123',
        '毎日の鹿肉バランス 4袋セット × 1',
        '合計：¥6,280',
        'お届け予定：2026-09-16 14:00〜16:00',
        ...(!isOrderConfirmed ? ['配送会社：ヤマト運輸', '送り状番号：1234-5678-9012'] : []),
      ]

  return (
    <section id={`campaign-preview-${setting.campaignKey}`} className="border-t border-gray-100 bg-gray-50/80 p-4 sm:p-5">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-[#3f3f3f] px-4 py-3 text-white">
          <div>
            <p className="text-sm font-bold">{setting.label}のLINEプレビュー</p>
            <p className="mt-0.5 text-xs text-gray-300">見出し・本文・自動挿入データを含む送信イメージ</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">プレビューを隠す</button>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="bg-[#8facd8] p-4 sm:p-6">
            <div className="mx-auto flex max-w-md items-start gap-2.5">
              <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/70 bg-[#075b36] text-sm font-bold text-white shadow-sm">然</div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-medium text-white/95">然-NEN-</p>
                <div className="overflow-hidden rounded-2xl rounded-tl-md bg-white shadow-md">
                  {setting.imageUrl && <img src={setting.imageUrl} alt="" className="aspect-[3/2] w-full object-cover" />}
                  <div className="space-y-3 p-4">
                    <h4 className="text-base font-bold leading-6 text-[#123f2b]">{title}</h4>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{body}</p>
                    <div className="space-y-1.5 border-t border-gray-100 pt-3">
                      {automaticDetails.map((detail) => <p key={detail} className="text-xs leading-5 text-slate-500">{detail}</p>)}
                    </div>
                  </div>
                  {setting.buttonLabel && <div className="border-t border-gray-100 p-3"><div className="rounded-lg bg-[#0f766e] py-2.5 text-center text-sm font-semibold text-white">{setting.buttonLabel}</div></div>}
                </div>
                <p className="mt-1 text-right text-[10px] text-white/80">配信イメージ</p>
              </div>
            </div>
          </div>
          <aside className="border-t border-gray-200 p-4 lg:border-l lg:border-t-0">
            <p className="text-sm font-bold text-gray-900">表示内容の見方</p>
            <div className="mt-4 space-y-4 text-xs leading-5 text-gray-600">
              <div><span className="mb-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">編集できる内容</span><p>見出し・本文・画像・下部ボタンです。</p></div>
              <div><span className="mb-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">自動で入る内容</span><p>{isBirthday ? 'ペット名・クーポン番号・有効期限' : '注文番号・商品・金額・配送情報'}は、お客様ごとの実データに置き換わります。</p></div>
              <p className="rounded-xl bg-amber-50 p-3 text-amber-800">ここでプレビューを開いても、LINEへの送信は発生しません。</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

export default function NenCampaignsPage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<Tab>('flow')
  const [settings, setSettings] = useState<NenCampaignSetting[]>([])
  const [columns, setColumns] = useState<NenColumn[]>([])
  const [pets, setPets] = useState<NenPetProfile[]>([])
  const [friends, setFriends] = useState<FriendOption[]>([])
  const [jobs, setJobs] = useState<Array<{ id: string; label: string; friendName: string | null; scheduledAt: string; status: string; attempts: number; lastError: string | null }>>([])
  const [overview, setOverview] = useState<{ activeCampaigns: number; jobs: { pending: number; sent: number; failed: number }; columns: number; pets: number; coupons: number } | null>(null)
  const [coupon, setCoupon] = useState({ isEnabled: true, codePrefix: 'NENBDAY', benefitLabel: 'お誕生日月限定クーポン', discountAmount: 500, validityDays: 31 })
  const [expanded, setExpanded] = useState<string | null>('arrival_check')
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
    setLoading(true)
    setLoadError('')
    if (!selectedAccountId) {
      setSettings([]); setColumns([]); setPets([]); setJobs([]); setOverview(null)
      setLoading(false)
      return
    }
    try {
      const [settingRes, columnRes, petRes, jobRes, overviewRes, couponRes] = await Promise.all([
        api.nenCampaigns.settings(selectedAccountId), api.nenCampaigns.columns(selectedAccountId),
        api.nenCampaigns.pets(selectedAccountId), api.nenCampaigns.jobs(selectedAccountId),
        api.nenCampaigns.overview(selectedAccountId), api.nenCampaigns.birthdayCoupon(selectedAccountId),
      ])
      if (sequence !== loadSequence.current) return
      if (!settingRes.success || !columnRes.success || !petRes.success || !jobRes.success || !overviewRes.success || !couponRes.success) throw new Error()
      setSettings(settingRes.data)
      setColumns(columnRes.data)
      setPets(petRes.data)
      setJobs(jobRes.data)
      setOverview(overviewRes.data)
      setCoupon(couponRes.data)
    } catch {
      if (sequence === loadSequence.current) setLoadError('フォロー配信の情報を読み込めませんでした。')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    setFriends([])
    setTestFriendId('')
    if (!selectedAccountId) return
    let cancelled = false
    void Promise.allSettled([
      api.friends.list({ accountId: selectedAccountId, limit: 100, includeTags: false }),
      api.accountSettings.getTestRecipientLoginUsers(selectedAccountId),
    ]).then(([friendResult, loginUserResult]) => {
      if (cancelled) return
      if (friendResult.status !== 'fulfilled' || !friendResult.value.success) return
      const friendResponse = friendResult.value
      // 100件より古い友だちでも、LINE連携済みログインユーザーは先頭へ残す。
      // NENテスト送信APIは同じLINEアカウントの友だちだけを受け付けるため、
      // sameAccount=true の候補だけを混ぜる。
      const loginUsers = loginUserResult.status === 'fulfilled' && loginUserResult.value.success
        ? loginUserResult.value.data
            .filter((candidate) => candidate.sameAccount)
            .map((candidate) => ({ id: candidate.id, displayName: candidate.staffName }))
        : []
      const accountFriends = friendResponse.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      const list = [...new Map([...loginUsers, ...accountFriends].map((friend) => [friend.id, friend])).values()]
      setFriends(list)
      setTestFriendId((current) =>
        list.some((friend) => friend.id === current) ? current : list[0]?.id || '',
      )
      setPetDraft((current) => ({ ...current, friendId: current.friendId || list[0]?.id || '' }))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const updateDraft = (key: string, patch: Partial<NenCampaignSetting>) => {
    setSettings((current) => current.map((item) => item.campaignKey === key ? { ...item, ...patch } : item))
  }

  const saveSetting = async (setting: NenCampaignSetting, override?: Partial<NenCampaignSetting>) => {
    if (!selectedAccountId) return
    const next = { ...setting, ...override }
    setSaving(setting.campaignKey)
    setNotice(null)
    try {
      await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, {
        isEnabled: next.isEnabled, title: next.title, bodyText: next.bodyText,
        delayDays: next.delayDays, deliveryTime: next.deliveryTime,
        buttonLabel: next.buttonLabel, buttonUrl: next.buttonUrl, imageUrl: next.imageUrl,
      })
      updateDraft(setting.campaignKey, next)
      setNotice({ tone: 'success', text: `${setting.label}の設定を保存しました。` })
    } catch { setNotice({ tone: 'error', text: `${setting.label}を保存できませんでした。` }) }
    finally { setSaving(null) }
  }

  const testSend = async (setting: NenCampaignSetting) => {
    if (!selectedAccountId || !testFriendId) {
      setNotice({ tone: 'error', text: 'テスト送信先を選択してください。' }); return
    }
    setTesting(setting.campaignKey)
    try {
      await api.nenCampaigns.testSend({ campaignKey: setting.campaignKey, accountId: selectedAccountId, friendId: testFriendId })
      setNotice({ tone: 'success', text: `${setting.label}をテスト送信しました。` })
    } catch { setNotice({ tone: 'error', text: 'テスト送信できませんでした。' }) }
    finally { setTesting(null) }
  }

  const deliverColumn = async (column: NenColumn, scheduledAt?: string) => {
    if (!selectedAccountId) return
    try {
      const result = await api.nenCampaigns.deliverColumn(column.id, { accountId: selectedAccountId, scheduledAt })
      if (!result.success) throw new Error(result.error)
      setNotice({ tone: 'success', text: `${result.data.queued}人分のコラム配信を予約しました。` })
      await load()
    } catch { setNotice({ tone: 'error', text: 'コラムを配信予約できませんでした。' }) }
  }

  const updateColumnDraft = (id: string, introText: string) => {
    setColumns((current) => current.map((column) => column.id === id ? { ...column, introText } : column))
  }

  const saveColumnMessage = async (column: NenColumn) => {
    if (!selectedAccountId) return
    if (!column.introText.trim()) {
      setNotice({ tone: 'error', text: '挨拶・要約文を入力してください。' }); return
    }
    setSavingColumnId(column.id)
    try {
      await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, column.introText)
      setNotice({ tone: 'success', text: `「${column.title}」の配信文を保存しました。` })
      setEditingColumnId(null)
    } catch { setNotice({ tone: 'error', text: 'コラムの配信文を保存できませんでした。' }) }
    finally { setSavingColumnId(null) }
  }

  const addPet = async () => {
    if (!selectedAccountId || !petDraft.friendId || !petDraft.name.trim()) { setNotice({ tone: 'error', text: 'LINEアカウント、LINEユーザー、ペットのお名前を入力してください。' }); return }
    try {
      await api.nenCampaigns.createPet(selectedAccountId, { ...petDraft, birthday: petDraft.birthday || undefined })
      setPetDraft((current) => ({ ...current, name: '', birthday: '', gender: 'unknown' }))
      setNotice({ tone: 'success', text: 'ペット情報を登録しました。' })
      await load()
    } catch { setNotice({ tone: 'error', text: 'ペット情報を登録できませんでした。' }) }
  }

  const saveCoupon = async () => {
    if (!selectedAccountId) return
    try {
      await api.nenCampaigns.updateBirthdayCoupon(selectedAccountId, coupon)
      setNotice({ tone: 'success', text: 'お誕生日クーポン設定を保存しました。' })
    } catch { setNotice({ tone: 'error', text: 'クーポン設定を保存できませんでした。' }) }
  }

  if (loading) return <><Header title="NEN配信" /><main className="p-6"><ListState kind="loading" /></main></>

  if (loadError) {
    return (
      <>
        <Header title="NEN配信" />
        <main className="p-6">
          <ListState
            kind="error"
            description={loadError}
            action={(
              <Button variant="primary" onClick={() => void load()}>
                フォロー配信を再読み込み
              </Button>
            )}
          />
        </main>
      </>
    )
  }

  return (
    <>
      {/* Pen canonical: V2 9-1 NEN配信 / ケアフラグ連動 */}
      <div data-design="Head">
        <Header
          title="NEN配信"
          description="購入後のご案内、NENコラム、お誕生日クーポンなど、お客様との関係を育てる配信を管理します。"
        />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">配信ジョブ</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {settings.length}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            稼働中 {settings.filter((x) => x.isEnabled).length}
          </p>
        </div>
        {/* 配信した通数・到達率・失敗を、この画面では集計していない。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月の配信</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">この画面では集計していません</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">待機中</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {overview?.jobs.pending ?? '—'}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">送信待ちのジョブ</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">失敗</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {overview?.jobs.failed ?? '—'}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {overview ? (overview.jobs.failed === 0 ? '失敗の記録はありません' : '失敗した配信を確認してください') : '確認できません'}
          </p>
        </div>
      </div>
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="hidden" aria-hidden="true">
          <p className="text-xs font-semibold tracking-[0.25em] text-emerald-100">NEN CUSTOMER JOURNEY</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">購入後も、LINEで丁寧につながる</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50">商品到着後の確認、口コミ、次の商品提案、コラム、お誕生日までを一つの画面で管理します。</p>
          {overview && <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['稼働中', `${overview.activeCampaigns}件`], ['配信待ち', `${overview.jobs.pending}件`],
              ['送信済み', `${overview.jobs.sent}件`], ['コラム', `${overview.columns}件`], ['ペット情報', `${overview.pets}件`],
            ].map(([label, value]) => <div key={label} className="rounded-2xl bg-white/10 p-3 backdrop-blur"><p className="text-xs text-emerald-100">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}
          </div>}
        </section>

        {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>}

        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2">
          {([['flow', '配信フロー'], ['columns', 'NENコラム'], ['pets', 'ペット・誕生日'], ['history', '配信履歴']] as Array<[Tab, string]>).map(([key, label]) =>
            <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${tab === key ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{label}</button>)}
        </div>

        {tab === 'flow' && <section className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:flex sm:items-center sm:justify-between">
            <div><h2 className="font-bold text-gray-900">テスト送信先</h2><p className="mt-1 text-xs text-gray-500">保存後、実際のLINE表示を確認できます。</p></div>
            <select value={testFriendId} onChange={(e) => setTestFriendId(e.target.value)} className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm sm:mt-0 sm:w-72">
              <option value="">未設定</option>
              {friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName || '名前未取得'}</option>)}
            </select>
          </div>
          {settings.map((setting) => (
            <article key={setting.campaignKey} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-center gap-4">
                  <Toggle checked={setting.isEnabled} disabled={saving === setting.campaignKey} label={`${setting.label}を切り替える`} onChange={() => void saveSetting(setting, { isEnabled: !setting.isEnabled })} />
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-gray-900">{setting.label}</h3><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{categoryLabel[setting.category]}</span></div>
                    <p className="mt-1 text-xs text-gray-500">{formatCampaignTiming(setting)}</p></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-expanded={previewCampaignKey === setting.campaignKey}
                    aria-controls={`campaign-preview-${setting.campaignKey}`}
                    onClick={() => setPreviewCampaignKey(previewCampaignKey === setting.campaignKey ? null : setting.campaignKey)}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold ${previewCampaignKey === setting.campaignKey ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                  >{previewCampaignKey === setting.campaignKey ? 'プレビューを隠す' : 'LINEプレビュー'}</button>
                  <button onClick={() => setExpanded(expanded === setting.campaignKey ? null : setting.campaignKey)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">{expanded === setting.campaignKey ? '編集を閉じる' : '内容を編集'}</button>
                  {/* 設計 9-1-1。送り方まで含めて1画面で直す。 */}
                  <Link href={`/nen-campaigns/edit?key=${encodeURIComponent(setting.campaignKey)}`} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">送り方も編集</Link>
                </div>
              </div>
              {previewCampaignKey === setting.campaignKey && <CampaignLinePreview setting={setting} onClose={() => setPreviewCampaignKey(null)} />}
              {expanded === setting.campaignKey && <div className="border-t border-gray-100 bg-gray-50/70 p-4 sm:p-5">
                <div className="mx-auto max-w-4xl space-y-4">
                  {setting.category === 'follow_up' && <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-gray-700">発送から何日後<input type="number" min={1} max={365} value={setting.delayDays} onChange={(e) => updateDraft(setting.campaignKey, { delayDays: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">送信時刻<input type="time" value={setting.deliveryTime} onChange={(e) => updateDraft(setting.campaignKey, { deliveryTime: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label></div>}
                  <label className="block text-sm font-semibold text-gray-700">見出し<input value={setting.title} maxLength={120} onChange={(e) => updateDraft(setting.campaignKey, { title: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label>
                  <label className="block text-sm font-semibold text-gray-700">本文<textarea value={setting.bodyText} rows={5} maxLength={1500} onChange={(e) => updateDraft(setting.campaignKey, { bodyText: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 leading-6" /></label>
                  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-gray-700">ボタン名<input value={setting.buttonLabel || ''} maxLength={20} onChange={(e) => updateDraft(setting.campaignKey, { buttonLabel: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">リンク先<input type="url" value={setting.buttonUrl || ''} onChange={(e) => updateDraft(setting.campaignKey, { buttonUrl: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label></div>
                  <label className="block text-sm font-semibold text-gray-700">画像URL（任意）<input type="url" value={setting.imageUrl || ''} onChange={(e) => updateDraft(setting.campaignKey, { imageUrl: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => void testSend(setting)} disabled={testing === setting.campaignKey} className="rounded-xl border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700">{testing === setting.campaignKey ? '送信中...' : 'テスト送信'}</button><button onClick={() => void saveSetting(setting)} disabled={saving === setting.campaignKey} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white">{saving === setting.campaignKey ? '保存中...' : '保存'}</button></div>
                </div>
              </div>}
            </article>
          ))}
        </section>}

        {tab === 'columns' && <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-secondary">EC側から届いたコラムと、ここで書いた下書きが並びます。</p>
            {/* 記事本文はEC側が正本。ここで作れるのは「外部記事へつなぐ下書き」だけ。 */}
            <Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><strong>EC-CUBEと自動連携します。</strong><br />NENコラムを保存すると、タイトル・概要・アイキャッチ・記事URLがここへ下書きとして届きます。確認後にLINE配信してください。</div>
          {columns.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">同期されたコラムはまだありません。</div> : columns.map((column) => {
            const isPreviewOpen = previewColumnId === column.id
            return (
              <article key={column.id} className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-[180px_1fr] sm:p-5">
                {column.imageUrl ? <img src={column.imageUrl} alt="" className="aspect-[3/2] w-full rounded-xl object-cover" /> : <div className="aspect-[3/2] rounded-xl bg-gray-100" />}
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{column.category || 'コラム'}</span><span className="text-xs text-gray-400">{columnDeliveryStatusLabel[column.deliveryStatus] ?? '—'}</span></div>
                  <h3 className="mt-2 text-lg font-bold text-gray-900">{column.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-600">{column.excerpt}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={column.articleUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">記事を確認</a>
                    <button
                      type="button"
                      aria-expanded={isPreviewOpen}
                      aria-controls={`column-preview-${column.id}`}
                      onClick={() => setPreviewColumnId(isPreviewOpen ? null : column.id)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold ${isPreviewOpen ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                    >
                      {isPreviewOpen ? 'プレビューを隠す' : 'LINEプレビュー'}
                    </button>
                    <button type="button" onClick={() => setEditingColumnId(editingColumnId === column.id ? null : column.id)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
                      {editingColumnId === column.id ? '編集を閉じる' : '配信文を編集'}
                    </button>
                    <button onClick={() => void deliverColumn(column)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">今すぐ配信予約</button>
                    <input type="datetime-local" aria-label="配信日時" onChange={(e) => { if (e.target.value) void deliverColumn(column, new Date(e.target.value).toISOString()) }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  {editingColumnId === column.id && <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <label className="block text-sm font-semibold text-gray-800">カードの前に送る挨拶・要約文
                      <textarea value={column.introText} maxLength={1500} rows={7} onChange={(e) => updateColumnDraft(column.id, e.target.value)} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm leading-6" />
                    </label>
                    <div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs text-gray-500">タイトルと概要から自動作成されています。配信前に自由に編集できます。</p><span className="text-xs text-gray-400">{column.introText.length}/1500</span></div>
                    <div className="mt-3 flex justify-end"><button type="button" onClick={() => void saveColumnMessage(column)} disabled={savingColumnId === column.id} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{savingColumnId === column.id ? '保存中...' : '配信文を保存'}</button></div>
                  </div>}
                </div>
                {isPreviewOpen && <ColumnLinePreview column={column} onClose={() => setPreviewColumnId(null)} />}
              </article>
            )
          })}
        </section>}

        {tab === 'pets' && <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4"><div className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold text-gray-900">ペット情報を登録</h2><p className="mt-1 text-sm text-gray-500">LINEログイン会員が任意入力した情報も、ここに自動保存されます。</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><select value={petDraft.friendId} onChange={(e) => setPetDraft({ ...petDraft, friendId: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5"><option value="">LINEユーザーを選択</option>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName || '名前未取得'}</option>)}</select><input placeholder="わんちゃん・ねこちゃんのお名前" value={petDraft.name} onChange={(e) => setPetDraft({ ...petDraft, name: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5" /><SelectField value={petDraft.animalType} onChange={(e) => setPetDraft({ ...petDraft, animalType: e.target.value })} options={[{ value: "dog", label: "わんちゃん" }, { value: "cat", label: "ねこちゃん" }, { value: "other", label: "その他" }]} className="rounded-xl border border-gray-200 px-3 py-2.5" /><SelectField value={petDraft.gender} onChange={(e) => setPetDraft({ ...petDraft, gender: e.target.value })} options={[{ value: "unknown", label: "回答しない" }, { value: "male", label: "男の子" }, { value: "female", label: "女の子" }]} className="rounded-xl border border-gray-200 px-3 py-2.5" /><input type="date" value={petDraft.birthday} onChange={(e) => setPetDraft({ ...petDraft, birthday: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5" /><button onClick={() => void addPet()} className="rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white">登録する</button></div></div>
            <div className="space-y-3">{pets.map((pet) => <div key={pet.id} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4"><div><p className="font-bold text-gray-900">{pet.name} <span className="ml-1 text-xs font-normal text-gray-400">{pet.animalType === 'dog' ? 'わんちゃん' : pet.animalType === 'cat' ? 'ねこちゃん' : 'その他'}</span></p><p className="mt-1 text-sm text-gray-500">{pet.ownerName || '名前未取得'} · {pet.gender === 'male' ? '男の子' : pet.gender === 'female' ? '女の子' : '性別未回答'} · {pet.birthday || '誕生日未登録'}</p></div><button onClick={() => selectedAccountId && void api.nenCampaigns.deletePet(selectedAccountId, pet.id).then(load)} className="text-sm text-red-500">削除</button></div>)}</div></div>
          <div className="h-fit rounded-2xl border border-gray-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-gray-900">お誕生日クーポン</h2><p className="mt-1 text-xs text-gray-500">誕生日の3日前、10:00に自動送信</p></div><Toggle checked={coupon.isEnabled} label="誕生日クーポンを切り替える" onChange={() => setCoupon({ ...coupon, isEnabled: !coupon.isEnabled })} /></div><div className="mt-5 space-y-4"><label className="block text-sm font-semibold text-gray-700">コードの先頭<input value={coupon.codePrefix} onChange={(e) => setCoupon({ ...coupon, codePrefix: e.target.value.toUpperCase() })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">特典名<input value={coupon.benefitLabel} onChange={(e) => setCoupon({ ...coupon, benefitLabel: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">割引金額<input type="number" min={1} max={100000} value={coupon.discountAmount} onChange={(e) => setCoupon({ ...coupon, discountAmount: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">有効日数<input type="number" min={1} max={365} value={coupon.validityDays} onChange={(e) => setCoupon({ ...coupon, validityDays: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><button onClick={() => void saveCoupon()} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white">設定を保存</button></div></div>
        </section>}

        {tab === 'history' && <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-gray-900">直近100件の配信</h2></div><div className="divide-y divide-gray-100">{jobs.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">配信履歴はまだありません。</p> : jobs.map((job) => <div key={job.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1.2fr_1fr_1fr_auto]"><div><p className="font-semibold text-gray-900">{job.label}</p><p className="text-xs text-gray-400">{job.friendName || '名前未取得'}</p></div><p className="text-gray-600">予定：{formatNenJobDateTime(job.scheduledAt)}</p><p className="text-gray-600">試行：{job.attempts}回</p><span className={`h-fit rounded-full px-2.5 py-1 text-xs font-semibold ${job.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : job.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{jobStatusLabel[job.status] ?? '状態を確認できません'}</span>{job.lastError && <p className="sm:col-span-4 text-xs text-red-500">{job.lastError}</p>}</div>)}</div></section>}
      </main>
    </>
  )
}
