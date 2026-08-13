'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import type { FriendDetail, FriendListItem, NenFriendOverview } from '@/lib/api'
import { api } from '@/lib/api'
import TagBadge from './tag-badge'

type Props = { friend: FriendListItem; allTags: Tag[]; onTagsChanged: () => void; onClose: () => void }
const text = (value: unknown, fallback = '未登録') => value == null || value === '' ? fallback : String(value)
const number = (value: unknown) => Number(value || 0)
const jsonValue = (value: unknown, fallback: unknown) => {
  if (typeof value !== 'string' || !value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
const date = (value: unknown) => text(value, '—').replace('T', ' ').slice(0, 16)
const yen = (value: unknown) => `¥${number(value).toLocaleString('ja-JP')}`

const rankTone: Record<string, string> = {
  '会員': 'bg-emerald-50 text-emerald-800',
  'シルバー会員': 'bg-slate-100 text-slate-700',
  'ゴールド会員': 'bg-amber-50 text-amber-800',
  'プラチナ会員': 'bg-indigo-50 text-indigo-800',
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 font-bold text-gray-900">{value}</p></div>
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center gap-2"><h3 className="font-bold text-gray-900">{title}</h3>{count !== undefined && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{count}件</span>}</div>{children}</section>
}

export default function NenFriendDetailDrawer({ friend, allTags, onTagsChanged, onClose }: Props) {
  const [overview, setOverview] = useState<NenFriendOverview | null>(null)
  const [detail, setDetail] = useState<FriendDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [tagLoading, setTagLoading] = useState(false)
  const [tagError, setTagError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.nenMembers.friendOverview(friend.id), api.friends.get(friend.id)])
      .then(([nen, base]) => {
        if (!active) return
        if (!nen.success || !base.success) throw new Error('詳細情報を取得できませんでした。')
        setOverview(nen.data)
        setDetail(base.data)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '詳細情報を取得できませんでした。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [friend.id])

  const member = overview?.member
  const availableTags = useMemo(() => allTags.filter((tag) => !detail?.tags.some((current) => current.id === tag.id)), [allTags, detail?.tags])
  const orders = useMemo(() => jsonValue(member?.orders_json, []) as Array<Record<string, unknown>>, [member])
  const subscription = useMemo(() => jsonValue(member?.subscription_json, null) as Record<string, unknown> | null, [member])
  const healthByPet = useMemo(() => {
    const grouped = new Map<string, Array<Record<string, unknown>>>()
    for (const log of overview?.healthLogs || []) {
      const key = text(log.pet_id, '')
      grouped.set(key, [...(grouped.get(key) || []), log])
    }
    return grouped
  }, [overview])

  const addTag = async () => {
    if (!selectedTagId || !detail) return
    const tag = allTags.find((item) => item.id === selectedTagId)
    if (!tag) return
    setTagLoading(true)
    setTagError('')
    try {
      await api.friends.addTag(friend.id, selectedTagId)
      setDetail({ ...detail, tags: [...detail.tags, tag] })
      setSelectedTagId('')
      onTagsChanged()
    } catch {
      setTagError('タグの追加に失敗しました。')
    } finally {
      setTagLoading(false)
    }
  }

  const removeTag = async (tagId: string) => {
    if (!detail) return
    setTagLoading(true)
    setTagError('')
    try {
      await api.friends.removeTag(friend.id, tagId)
      setDetail({ ...detail, tags: detail.tags.filter((tag) => tag.id !== tagId) })
      onTagsChanged()
    } catch {
      setTagError('タグの削除に失敗しました。')
    } finally {
      setTagLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/35" role="dialog" aria-modal="true" aria-label={`${friend.displayName || '友だち'}の詳細`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="ml-auto flex h-full w-full max-w-3xl flex-col bg-[#f6f8f7] shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            {friend.pictureUrl ? <img src={friend.pictureUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">{friend.displayName?.slice(0, 1) || '?'}</div>}
            <div className="min-w-0"><p className="truncate text-lg font-bold text-gray-900">{friend.displayName || '名前未取得'}</p><p className="text-xs text-gray-500">友だち・EC・ペット情報</p></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600">閉じる</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && <div className="rounded-2xl bg-white p-12 text-center text-sm text-gray-500">情報を読み込んでいます...</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {!loading && overview && <div className="space-y-4">
            <Section title="会員情報">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-sm font-bold ${rankTone[text(member?.member_rank, '会員')] || rankTone['会員']}`}>{text(member?.member_rank, '会員')}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs ${friend.isFollowing ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{friend.isFollowing ? '友だち登録中' : 'ブロック・退会'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="保有ポイント" value={`${number(member?.point_balance).toLocaleString('ja-JP')} pt`} /><Stat label="累計購入額" value={yen(member?.purchase_amount)} /><Stat label="購入回数" value={`${number(member?.purchase_count)}回`} /><Stat label="EC顧客ID" value={text(member?.customer_id)} /></div>
              <dl className="mt-4 grid gap-2 text-xs text-gray-600 sm:grid-cols-2"><div><dt className="font-semibold text-gray-500">LINEユーザーID</dt><dd className="mt-1 break-all font-mono">{friend.lineUserId}</dd></div><div><dt className="font-semibold text-gray-500">登録日</dt><dd className="mt-1">{date(friend.createdAt)}</dd></div><div><dt className="font-semibold text-gray-500">EC最終同期</dt><dd className="mt-1">{date(member?.synced_at)}</dd></div><div><dt className="font-semibold text-gray-500">タグ</dt><dd className="mt-1">{detail?.tags.map((tag) => tag.name).join('、') || '未登録'}</dd></div></dl>
            </Section>

            <Section title="タグ管理" count={detail?.tags.length || 0}>
              <p className="mb-3 text-xs leading-5 text-gray-500">この友だちに付与されている自動タグ・手動タグをまとめて確認できます。</p>
              {tagError && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{tagError}</div>}
              <div className="max-h-52 overflow-y-auto rounded-xl bg-gray-50 p-3">
                {detail?.tags.length ? <div className="flex flex-wrap gap-2">{detail.tags.map((tag) => <TagBadge key={tag.id} tag={tag} onRemove={() => removeTag(tag.id)} />)}</div> : <p className="text-sm text-gray-500">タグはまだありません。</p>}
              </div>
              {availableTags.length > 0 && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <select value={selectedTagId} onChange={(event) => setSelectedTagId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100">
                  <option value="">追加するタグを選択</option>
                  {availableTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
                <button type="button" onClick={addTag} disabled={!selectedTagId || tagLoading} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">タグを追加</button>
              </div>}
            </Section>

            <Section title="ペット情報" count={overview.pets.length}>
              {overview.pets.length === 0 ? <p className="text-sm text-gray-500">ペット情報は未登録です。</p> : <div className="space-y-3">{overview.pets.map((pet) => {
                const logs = healthByPet.get(text(pet.id, '')) || []
                const latest = logs[0]
                const concerns = jsonValue(pet.concerns, []) as string[]
                return <article key={text(pet.id)} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-[#0d4a32]">{text(pet.name)}ちゃん</p><p className="mt-1 text-xs text-gray-600">{pet.animal_type === 'cat' ? 'ねこちゃん' : pet.animal_type === 'dog' ? 'わんちゃん' : 'その他'}・{text(pet.breed)}・{pet.gender === 'male' ? '男の子' : pet.gender === 'female' ? '女の子' : '性別未回答'}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-600">誕生日 {text(pet.birthday)}</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="登録体重" value={pet.weight_kg ? `${pet.weight_kg}kg` : '未登録'} /><Stat label="推奨給与量" value={pet.recommended_daily_min_grams ? `${pet.recommended_daily_min_grams}〜${pet.recommended_daily_max_grams}g` : '未計算'} /><Stat label="鹿肉目安" value={pet.venison_daily_grams ? `${pet.venison_daily_grams}g/日` : '未計算'} /><Stat label="健康記録" value={`${logs.length}件`} /></div>{concerns.length > 0 && <p className="mt-3 text-xs text-gray-600">お悩み：{concerns.join('、')}</p>}{latest && <p className="mt-2 text-xs text-gray-600">最新記録（{text(latest.logged_on)}）：体重 {text(latest.weight_kg, '—')}kg・心拍 {text(latest.heart_rate_bpm, '—')}回/分・呼吸 {text(latest.respiratory_rate_bpm, '—')}回/分・食いつき {text(latest.appetite)}</p>}</article>
              })}</div>}
            </Section>

            <Section title="注文履歴・定期便" count={orders.length}>
              {subscription && <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm"><p className="font-bold text-emerald-900">定期便</p><p className="mt-1 text-xs leading-5 text-emerald-800">状態：{text(subscription.status)}　次回：{text(subscription.next_billing_date ?? subscription.nextBillingDate)}</p></div>}
              {orders.length === 0 ? <p className="text-sm text-gray-500">注文履歴はまだ連携されていません。</p> : <div className="divide-y divide-gray-100">{orders.slice(0, 20).map((order, index) => <div key={text(order.id ?? order.order_number, String(index))} className="py-3 text-sm"><div className="flex justify-between gap-3"><b>注文 {text(order.order_number ?? order.number ?? order.id)}</b><span>{yen(order.total ?? order.amount)}</span></div><p className="mt-1 text-xs text-gray-500">{date(order.ordered_at ?? order.created_at ?? order.order_date)}　{text(order.status, '')}</p></div>)}</div>}
            </Section>

            <Section title="写真投稿" count={overview.photos.length}>
              {overview.photos.length === 0 ? <p className="text-sm text-gray-500">写真投稿はありません。</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{overview.photos.map((photo) => <article key={text(photo.id)} className="overflow-hidden rounded-xl border border-gray-200"><img src={text(photo.image_url, '')} alt="" className="aspect-square w-full object-cover" /><div className="p-2 text-xs"><b>{text(photo.pet_name)}ちゃん</b><p className="mt-1 text-gray-500">{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '採用' : '見送り'}・{number(photo.awarded_points)}pt</p></div></article>)}</div>}
            </Section>

            <Section title="ポイント履歴" count={overview.pointLedger.length}>
              {overview.pointLedger.length === 0 ? <p className="text-sm text-gray-500">ポイント履歴はありません。</p> : <div className="divide-y divide-gray-100">{overview.pointLedger.slice(0, 20).map((entry) => <div key={text(entry.id)} className="flex items-center justify-between gap-3 py-2 text-sm"><div><b>{text(entry.reason)}</b><p className="text-xs text-gray-400">{date(entry.created_at)}</p></div><span className={number(entry.amount) >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>{number(entry.amount) >= 0 ? '+' : ''}{number(entry.amount)}pt</span></div>)}</div>}
            </Section>

            <Section title="フォーム回答" count={detail?.formSubmissions.length || 0}>
              {!detail?.formSubmissions.length ? <p className="text-sm text-gray-500">フォーム回答はありません。</p> : <div className="space-y-2">{detail.formSubmissions.map((form) => <div key={form.id} className="rounded-xl bg-gray-50 p-3 text-sm"><b>{form.formName}</b><p className="mt-1 text-xs text-gray-500">{date(form.createdAt)}</p></div>)}</div>}
            </Section>

            <Section title="EC連携履歴" count={overview.ecEvents.length}>
              {overview.ecEvents.length === 0 ? <p className="text-sm text-gray-500">EC連携履歴はありません。</p> : <div className="divide-y divide-gray-100">{overview.ecEvents.slice(0, 20).map((event) => <div key={text(event.id)} className="flex items-center justify-between gap-3 py-2 text-sm"><div><b>{text(event.event_type)}</b><p className="text-xs text-gray-400">{date(event.received_at)}</p></div><span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{text(event.status)}</span></div>)}</div>}
            </Section>
          </div>}
        </div>
        <footer className="border-t border-gray-200 bg-white p-3 sm:p-4"><a href={`/chats?friend=${encodeURIComponent(friend.id)}`} className="block rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white">このユーザーとチャットする</a></footer>
      </aside>
    </div>
  )
}
