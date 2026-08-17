'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'

type PhotoStatus = 'all' | 'pending' | 'adopted' | 'rejected'
const text = (value: unknown) => String(value ?? '')

export default function PhotoReviewsPage() {
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([])
  const [status, setStatus] = useState<PhotoStatus>('pending')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.nenMembers.photos()
      if (response.success) setPhotos(response.data)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => ({
    all: photos.length,
    pending: photos.filter((photo) => text(photo.status) === 'pending').length,
    adopted: photos.filter((photo) => text(photo.status) === 'adopted').length,
    rejected: photos.filter((photo) => text(photo.status) === 'rejected').length,
  }), [photos])
  const visiblePhotos = useMemo(() => status === 'all' ? photos : photos.filter((photo) => text(photo.status) === status), [photos, status])

  const review = async (id: string, nextStatus: 'adopted' | 'rejected') => {
    setReviewing(id)
    try {
      const response = await api.nenMembers.reviewPhoto(id, { status: nextStatus, points: nextStatus === 'adopted' ? 5 : 0 })
      if (!response.success) throw new Error(response.error)
      setNotice(nextStatus === 'adopted' ? `採用しました。ECへ${response.data.awardedPoints}ポイントを付与し、公開ギャラリーへ掲載しました。` : '今回は見送りとして保存しました。')
      await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '審査結果を保存できませんでした。') }
    finally { setReviewing(null) }
  }

  return <>
    <div data-design="Head">
      <Header
        title="写真審査"
        description="友だちから投稿された写真を確認して、公開してよいものを承認します。承認するとマイル付与とお礼の配信が自動で走ります。"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
            {/* 審査の基準を保存する場所が無い。いまは人の判断だけ。 */}
            <button
              disabled
              title="審査ルールの設定は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              審査ルールを設定
            </button>
            {/* まとめて承認する口が無い。1枚ずつ承認する。 */}
            <button
              disabled
              title="まとめて承認は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              選択をまとめて承認
            </button>
          </div>
        }
      />
    </div>
    <div data-design="KPIs" className="mx-auto mb-4 grid max-w-7xl grid-cols-1 gap-4 px-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">未審査</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.pending}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">確認をお待ちしています</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">承認済</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.adopted}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開してよいと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">見送り</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.rejected}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">公開しないと判断したもの</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <p className="text-ink-faint text-xs">投稿の合計</p>
        <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
          {counts.all}
          <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
        </p>
        <p className="text-ink-faint mt-0.5 text-xs">これまでに届いた数</p>
      </div>
    </div>
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <section className="rounded-3xl bg-gradient-to-br from-[#0d4a32] to-[#16815b] p-6 text-white shadow-lg sm:p-8">
        <p className="text-xs font-semibold tracking-[.22em] text-emerald-100">NEN CUSTOMER PHOTO</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">お客様の写真を、然-NEN-の物語へ</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50">投稿写真を審査し、採用した写真だけをLINE会員画面と公式サイトへ掲載します。採用時はECポイントを5ポイント付与します。</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['審査待ち', counts.pending], ['採用', counts.adopted], ['見送り', counts.rejected], ['全投稿', counts.all]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-emerald-100">{label}</p><p className="mt-1 text-xl font-bold">{value}件</p></div>)}
        </div>
      </section>

      {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2">
        {([['pending', '審査待ち'], ['adopted', '採用済み'], ['rejected', '見送り'], ['all', 'すべて']] as Array<[PhotoStatus, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setStatus(value)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${status === value ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{label}（{counts[value]}）</button>)}
      </div>

      {loading ? <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">写真を読み込んでいます...</div> : visiblePhotos.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">この状態の写真はありません。</div> : <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visiblePhotos.map((photo) => <article key={text(photo.id)} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <img src={text(photo.image_url)} alt={`${text(photo.pet_name)}ちゃんの投稿写真`} className="aspect-square w-full object-cover" />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-gray-900">{text(photo.pet_name)}ちゃん</p><p className="mt-1 text-xs text-gray-500">{text(photo.owner_name) || '名前未取得'}・{text(photo.created_at).replace('T', ' ').slice(0, 16)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${photo.status === 'pending' ? 'bg-amber-50 text-amber-700' : photo.status === 'adopted' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{photo.status === 'pending' ? '審査待ち' : photo.status === 'adopted' ? '採用' : '見送り'}</span></div>
            <p className="mt-3 min-h-10 text-sm leading-5 text-gray-700">{text(photo.caption) || 'コメントなし'}</p>
            {photo.status === 'adopted' && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">5ポイント付与済み・公開ギャラリー掲載中</p>}
            {photo.status === 'pending' && <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'rejected')} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50">見送る</button><button type="button" disabled={reviewing === photo.id} onClick={() => void review(text(photo.id), 'adopted')} className="rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{reviewing === photo.id ? '処理中...' : '採用して5pt付与'}</button></div>}
          </div>
        </article>)}
      </section>}
    </main>
  </>
}
