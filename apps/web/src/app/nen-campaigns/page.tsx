'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type NenCampaignSetting, type NenColumn, type NenPetProfile } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Tab = 'flow' | 'columns' | 'pets' | 'history'
type Notice = { tone: 'success' | 'error'; text: string }
type FriendOption = { id: string; displayName: string | null }

const categoryLabel: Record<NenCampaignSetting['category'], string> = {
  transactional: '購入通知', follow_up: '購入後フォロー', column: 'コンテンツ', birthday: '記念日',
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
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
  const [testFriendId, setTestFriendId] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [petDraft, setPetDraft] = useState({ friendId: '', name: '', animalType: 'dog', gender: 'unknown', birthday: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingRes, columnRes, petRes, jobRes, overviewRes, couponRes] = await Promise.all([
        api.nenCampaigns.settings(), api.nenCampaigns.columns(), api.nenCampaigns.pets(),
        api.nenCampaigns.jobs(), api.nenCampaigns.overview(), api.nenCampaigns.birthdayCoupon(),
      ])
      if (!settingRes.success || !columnRes.success || !petRes.success || !jobRes.success || !overviewRes.success || !couponRes.success) throw new Error()
      setSettings(settingRes.data)
      setColumns(columnRes.data)
      setPets(petRes.data)
      setJobs(jobRes.data)
      setOverview(overviewRes.data)
      setCoupon(couponRes.data)
    } catch {
      setNotice({ tone: 'error', text: 'NEN配信の情報を読み込めませんでした。' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selectedAccountId) return
    void api.friends.list({ accountId: selectedAccountId, limit: 100, includeTags: false }).then((res) => {
      if (!res.success) return
      const list = res.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      setFriends(list)
      setTestFriendId((current) => current || list[0]?.id || '')
      setPetDraft((current) => ({ ...current, friendId: current.friendId || list[0]?.id || '' }))
    }).catch(() => undefined)
  }, [selectedAccountId])

  const updateDraft = (key: string, patch: Partial<NenCampaignSetting>) => {
    setSettings((current) => current.map((item) => item.campaignKey === key ? { ...item, ...patch } : item))
  }

  const saveSetting = async (setting: NenCampaignSetting, override?: Partial<NenCampaignSetting>) => {
    const next = { ...setting, ...override }
    setSaving(setting.campaignKey)
    setNotice(null)
    try {
      await api.nenCampaigns.updateSetting(setting.campaignKey, {
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

  const addPet = async () => {
    if (!petDraft.friendId || !petDraft.name.trim()) { setNotice({ tone: 'error', text: 'LINEユーザーとペットのお名前を入力してください。' }); return }
    try {
      await api.nenCampaigns.createPet({ ...petDraft, birthday: petDraft.birthday || undefined })
      setPetDraft((current) => ({ ...current, name: '', birthday: '', gender: 'unknown' }))
      setNotice({ tone: 'success', text: 'ペット情報を登録しました。' })
      await load()
    } catch { setNotice({ tone: 'error', text: 'ペット情報を登録できませんでした。' }) }
  }

  const saveCoupon = async () => {
    try {
      await api.nenCampaigns.updateBirthdayCoupon(coupon)
      setNotice({ tone: 'success', text: 'お誕生日クーポン設定を保存しました。' })
    } catch { setNotice({ tone: 'error', text: 'クーポン設定を保存できませんでした。' }) }
  }

  if (loading) return <><Header title="NEN配信" /><main className="p-6 text-sm text-gray-500">読み込み中...</main></>

  return (
    <>
      <Header title="NEN配信" />
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="rounded-3xl bg-gradient-to-br from-[#0d4a32] to-[#16815b] p-6 text-white shadow-lg sm:p-8">
          <p className="text-xs font-semibold tracking-[0.25em] text-emerald-100">NEN CUSTOMER JOURNEY</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">購入後も、LINEで丁寧につながる</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50">注文・発送から商品到着、口コミ、次の商品提案、コラム、お誕生日までを一つの画面で管理します。</p>
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
              {friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName || '名前未取得'}</option>)}
            </select>
          </div>
          {settings.map((setting) => (
            <article key={setting.campaignKey} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-center gap-4">
                  <Toggle checked={setting.isEnabled} disabled={saving === setting.campaignKey} label={`${setting.label}を切り替える`} onChange={() => void saveSetting(setting, { isEnabled: !setting.isEnabled })} />
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-gray-900">{setting.label}</h3><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{categoryLabel[setting.category]}</span></div>
                    <p className="mt-1 text-xs text-gray-500">{setting.delayDays === 0 ? 'イベント発生後すぐ' : `発送完了から${setting.delayDays}日後 ${setting.deliveryTime}`}</p></div>
                </div>
                <button onClick={() => setExpanded(expanded === setting.campaignKey ? null : setting.campaignKey)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">{expanded === setting.campaignKey ? '閉じる' : '内容を編集'}</button>
              </div>
              {expanded === setting.campaignKey && <div className="grid gap-5 border-t border-gray-100 bg-gray-50/70 p-4 lg:grid-cols-2 sm:p-5">
                <div className="space-y-4">
                  {setting.category === 'follow_up' && <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-gray-700">発送から何日後<input type="number" min={1} max={365} value={setting.delayDays} onChange={(e) => updateDraft(setting.campaignKey, { delayDays: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">送信時刻<input type="time" value={setting.deliveryTime} onChange={(e) => updateDraft(setting.campaignKey, { deliveryTime: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label></div>}
                  <label className="block text-sm font-semibold text-gray-700">見出し<input value={setting.title} maxLength={120} onChange={(e) => updateDraft(setting.campaignKey, { title: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label>
                  <label className="block text-sm font-semibold text-gray-700">本文<textarea value={setting.bodyText} rows={5} maxLength={1500} onChange={(e) => updateDraft(setting.campaignKey, { bodyText: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 leading-6" /></label>
                  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-gray-700">ボタン名<input value={setting.buttonLabel || ''} maxLength={20} onChange={(e) => updateDraft(setting.campaignKey, { buttonLabel: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">リンク先<input type="url" value={setting.buttonUrl || ''} onChange={(e) => updateDraft(setting.campaignKey, { buttonUrl: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label></div>
                  <label className="block text-sm font-semibold text-gray-700">画像URL（任意）<input type="url" value={setting.imageUrl || ''} onChange={(e) => updateDraft(setting.campaignKey, { imageUrl: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5" /></label>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => void testSend(setting)} disabled={testing === setting.campaignKey} className="rounded-xl border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700">{testing === setting.campaignKey ? '送信中...' : 'テスト送信'}</button><button onClick={() => void saveSetting(setting)} disabled={saving === setting.campaignKey} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white">{saving === setting.campaignKey ? '保存中...' : '保存'}</button></div>
                </div>
                <div className="rounded-2xl bg-[#d8efe2] p-5"><p className="mb-3 text-xs font-semibold text-emerald-800">LINEプレビュー</p><div className="overflow-hidden rounded-2xl bg-white shadow-sm">{setting.imageUrl && <img src={setting.imageUrl} alt="" className="aspect-[3/2] w-full object-cover" />}<div className="space-y-3 p-5"><h4 className="text-lg font-bold text-[#123f2b]">{setting.title}</h4><p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">{setting.bodyText}</p><p className="text-xs text-gray-400">注文番号・商品・配送情報は送信時に自動で入ります。</p>{setting.buttonLabel && <div className="rounded-lg bg-emerald-700 py-2.5 text-center text-sm font-semibold text-white">{setting.buttonLabel}</div>}</div></div></div>
              </div>}
            </article>
          ))}
        </section>}

        {tab === 'columns' && <section className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><strong>EC-CUBEと自動連携します。</strong><br />NENコラムを保存すると、タイトル・概要・アイキャッチ・記事URLがここへ下書きとして届きます。確認後にLINE配信してください。</div>
          {columns.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">同期されたコラムはまだありません。</div> : columns.map((column) => <article key={column.id} className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-[180px_1fr] sm:p-5">{column.imageUrl ? <img src={column.imageUrl} alt="" className="aspect-[3/2] w-full rounded-xl object-cover" /> : <div className="aspect-[3/2] rounded-xl bg-gray-100" />}<div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{column.category || 'コラム'}</span><span className="text-xs text-gray-400">{column.deliveryStatus}</span></div><h3 className="mt-2 text-lg font-bold text-gray-900">{column.title}</h3><p className="mt-1 text-sm leading-6 text-gray-600">{column.excerpt}</p><div className="mt-4 flex flex-wrap gap-2"><a href={column.articleUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">記事を確認</a><button onClick={() => void deliverColumn(column)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">今すぐ配信予約</button><input type="datetime-local" aria-label="配信日時" onChange={(e) => { if (e.target.value) void deliverColumn(column, new Date(e.target.value).toISOString()) }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" /></div></div></article>)}
        </section>}

        {tab === 'pets' && <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4"><div className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold text-gray-900">ペット情報を登録</h2><p className="mt-1 text-sm text-gray-500">LINEログイン会員が任意入力した情報も、ここに自動保存されます。</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><select value={petDraft.friendId} onChange={(e) => setPetDraft({ ...petDraft, friendId: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5"><option value="">LINEユーザーを選択</option>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName || '名前未取得'}</option>)}</select><input placeholder="わんちゃん・ねこちゃんのお名前" value={petDraft.name} onChange={(e) => setPetDraft({ ...petDraft, name: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5" /><select value={petDraft.animalType} onChange={(e) => setPetDraft({ ...petDraft, animalType: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5"><option value="dog">わんちゃん</option><option value="cat">ねこちゃん</option><option value="other">その他</option></select><select value={petDraft.gender} onChange={(e) => setPetDraft({ ...petDraft, gender: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5"><option value="unknown">回答しない</option><option value="male">男の子</option><option value="female">女の子</option></select><input type="date" value={petDraft.birthday} onChange={(e) => setPetDraft({ ...petDraft, birthday: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5" /><button onClick={() => void addPet()} className="rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white">登録する</button></div></div>
            <div className="space-y-3">{pets.map((pet) => <div key={pet.id} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4"><div><p className="font-bold text-gray-900">{pet.name} <span className="ml-1 text-xs font-normal text-gray-400">{pet.animalType === 'dog' ? 'わんちゃん' : pet.animalType === 'cat' ? 'ねこちゃん' : 'その他'}</span></p><p className="mt-1 text-sm text-gray-500">{pet.ownerName || '名前未取得'} · {pet.gender === 'male' ? '男の子' : pet.gender === 'female' ? '女の子' : '性別未回答'} · {pet.birthday || '誕生日未登録'}</p></div><button onClick={() => void api.nenCampaigns.deletePet(pet.id).then(load)} className="text-sm text-red-500">削除</button></div>)}</div></div>
          <div className="h-fit rounded-2xl border border-gray-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-gray-900">お誕生日クーポン</h2><p className="mt-1 text-xs text-gray-500">誕生日月の1日に自動送信</p></div><Toggle checked={coupon.isEnabled} label="誕生日クーポンを切り替える" onChange={() => setCoupon({ ...coupon, isEnabled: !coupon.isEnabled })} /></div><div className="mt-5 space-y-4"><label className="block text-sm font-semibold text-gray-700">コードの先頭<input value={coupon.codePrefix} onChange={(e) => setCoupon({ ...coupon, codePrefix: e.target.value.toUpperCase() })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">特典名<input value={coupon.benefitLabel} onChange={(e) => setCoupon({ ...coupon, benefitLabel: e.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">割引金額<input type="number" min={1} max={100000} value={coupon.discountAmount} onChange={(e) => setCoupon({ ...coupon, discountAmount: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-gray-700">有効日数<input type="number" min={1} max={365} value={coupon.validityDays} onChange={(e) => setCoupon({ ...coupon, validityDays: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><button onClick={() => void saveCoupon()} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white">設定を保存</button></div></div>
        </section>}

        {tab === 'history' && <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-gray-900">直近100件の配信</h2></div><div className="divide-y divide-gray-100">{jobs.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">配信履歴はまだありません。</p> : jobs.map((job) => <div key={job.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1.2fr_1fr_1fr_auto]"><div><p className="font-semibold text-gray-900">{job.label}</p><p className="text-xs text-gray-400">{job.friendName || '名前未取得'}</p></div><p className="text-gray-600">予定：{job.scheduledAt}</p><p className="text-gray-600">試行：{job.attempts}回</p><span className={`h-fit rounded-full px-2.5 py-1 text-xs font-semibold ${job.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : job.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{job.status}</span>{job.lastError && <p className="sm:col-span-4 text-xs text-red-500">{job.lastError}</p>}</div>)}</div></section>}
      </main>
    </>
  )
}
