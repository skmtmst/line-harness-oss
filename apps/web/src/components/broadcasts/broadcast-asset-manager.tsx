'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastAssetKind, type BroadcastMessageAsset } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'

const LABELS: Record<BroadcastAssetKind, { title: string; description: string; singular: string }> = {
  rich_message: { title: 'リッチメッセージ', description: '画像とタップ領域を組み合わせたテンプレートを作成し、一斉配信から引用できます。', singular: 'リッチメッセージ' },
  card_message: { title: 'カルーセル', description: '横にスワイプできるパネルを最大10枚まで作り、一斉配信から引用できます。', singular: 'カルーセル' },
  coupon: { title: 'クーポン', description: '一斉配信から引用できるクーポンテンプレートを登録します。', singular: 'クーポン' },
  research: { title: 'リサーチ', description: '一斉配信から引用できるアンケートテンプレートを登録します。', singular: 'リサーチ' },
}

type CardDraft = { id: string; imageUrl: string; title: string; description: string; actionLabel: string; actionUrl: string; template: string }
const newCard = (): CardDraft => ({ id: crypto.randomUUID(), imageUrl: '', title: '', description: '', actionLabel: '詳しく見る', actionUrl: '', template: 'product' })

/**
 * カルーセルのパネルの上限。
 *
 * **要件 11 §156 は「最大10パネル」。** 実装は 9 で止めていたので、
 * 10 枚目を作れないのに理由も出ない状態だった。
 * 呼び名も設計・要件にそろえて「パネル」にする（実装だけ「カード」だった）。
 */
const MAX_PANELS = 10

export default function BroadcastAssetManager({ kind }: { kind: BroadcastAssetKind }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BroadcastMessageAsset[]>([])
  const [editing, setEditing] = useState<BroadcastMessageAsset | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [description, setDescription] = useState('')
  const [actionUrl, setActionUrl] = useState('')
  const [cards, setCards] = useState<CardDraft[]>([newCard()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /*
   * 削除の確認。**ブラウザの `confirm()` は使わない。**
   * 見た目がブラウザ任せで設計の確認窓と違ううえ、画像比較にも写らない。
   * 何が止まって何が残るのかを本文で読ませたいので、共通の窓へ移した。
   *
   * **押した時点の対象とLINEアカウントを掴んでおく。** この画面は窓を
   * 開けたままヘッダからアカウントを切り替えられる。切り替わったのに
   * 消し続けると、いま見えていない一覧のものを消すことになる。
   */
  const [deleteTarget, setDeleteTarget] = useState<{ item: BroadcastMessageAsset; accountId: string | null } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const accountSwitched = deleteTarget !== null && deleteTarget.accountId !== selectedAccountId

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    // 二度押しを受け付けない。切り替わった後も走らせない。
    if (!deleteTarget || deleting || accountSwitched) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.broadcastMessageAssets.delete(deleteTarget.item.id)
      // 失敗を握りつぶさない。返事を見ずに一覧を読み直すと、消えていないのに
      // 消えたように見える。
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await load()
    } catch {
      // 生のAPIエラーは出さない。運用者が次に何をすればよいかだけを書く。
      setDeleteError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const load = useCallback(async () => {
    const res = await api.broadcastMessageAssets.list({ accountId: selectedAccountId || undefined, kind })
    if (res.success) setItems(res.data)
  }, [kind, selectedAccountId])
  useEffect(() => { void load() }, [load])

  const reset = () => { setEditing(null); setShowForm(false); setName(''); setImageUrl(''); setDescription(''); setActionUrl(''); setCards([newCard()]); setError('') }
  const startEdit = (item: BroadcastMessageAsset) => {
    setEditing(item); setShowForm(true); setName(item.name); setImageUrl(String(item.payload.imageUrl ?? '')); setDescription(String(item.payload.description ?? '')); setActionUrl(String(item.payload.actionUrl ?? ''))
    if (kind === 'card_message' && Array.isArray(item.payload.cards)) setCards(item.payload.cards as CardDraft[])
  }
  const upload = async (file: File, cardIndex?: number) => {
    if (!['image/jpeg','image/png'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('JPEG・PNG（10MB以下）を選択してください'); return }
    const res = await api.broadcastMessageAssets.upload(file)
    if (!res.success) { setError(res.error); return }
    if (cardIndex === undefined) setImageUrl(res.data.url)
    else setCards((current) => current.map((card, index) => index === cardIndex ? { ...card, imageUrl: res.data.url } : card))
  }
  const save = async () => {
    if (!name.trim()) { setError('名前を入力してください'); return }
    const payload: Record<string, unknown> = kind === 'card_message'
      ? { cards, moreCard: true }
      : kind === 'rich_message'
        ? { imageUrl, description, actionUrl, tapAreas: actionUrl ? [{ x: 0, y: 0, width: 100, height: 100, actionType: 'uri', value: actionUrl }] : [] }
        : { description, actionUrl }
    if (kind === 'rich_message' && !imageUrl) { setError('画像をアップロードしてください'); return }
    if (kind === 'card_message' && cards.some((card) => !card.title.trim())) { setError('すべてのカードにタイトルを入力してください'); return }
    setSaving(true); setError('')
    try {
      const res = editing
        ? await api.broadcastMessageAssets.update(editing.id, { name: name.trim(), payload })
        : await api.broadcastMessageAssets.create({ lineAccountId: selectedAccountId || null, kind, name: name.trim(), payload })
      if (!res.success) { setError(res.error); return }
      reset(); await load()
    } catch { setError('保存できませんでした') } finally { setSaving(false) }
  }

  const meta = LABELS[kind]
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3" data-design-node="FuBeQ"><div className="flex flex-wrap gap-2"><Button onClick={() => { reset(); setShowForm(true) }} variant="primary">{meta.singular}を作る</Button></div><Button href="/broadcasts/new?templatePicker=1">一斉配信で使う</Button></div>
    {showForm && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between"><h3 className="font-bold">{editing ? '編集' : `新しい${meta.singular}`}</h3><button onClick={reset} className="text-sm text-slate-500">閉じる</button></div>
      <div className="space-y-4"><label className="block text-sm font-bold text-slate-700">名前<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 font-normal" placeholder={`${meta.singular}の管理名`} /></label>
      {kind === 'rich_message' && <><label className="block rounded-xl border-2 border-dashed p-5 text-center text-sm text-slate-600">{imageUrl ? <img src={imageUrl} alt="" className="mx-auto max-h-56 rounded-lg" /> : '画像をアップロード'}<input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { const f=e.target.files?.[0]; if(f) void upload(f) }}/></label><input value={actionUrl} onChange={(e) => setActionUrl(e.target.value)} placeholder="タップ時に開くURL" className="w-full rounded-xl border px-3 py-2.5 text-sm" /></>}
      {kind === 'card_message' && <div className="space-y-3">{cards.map((card, index) => <div key={card.id} className="rounded-xl border bg-slate-50 p-4"><div className="mb-3 flex justify-between"><b className="text-sm">パネル {index + 1}</b><button disabled={cards.length === 1} onClick={() => setCards((all) => all.filter((_, i) => i !== index))} className="text-xs text-rose-600 disabled:opacity-30">削除</button></div><div className="grid gap-3 md:grid-cols-2"><select value={card.template} onChange={(e) => setCards((all) => all.map((c,i) => i===index ? {...c,template:e.target.value}:c))} className="rounded-lg border px-3 py-2 text-sm"><option value="product">プロダクト</option><option value="location">ロケーション</option><option value="person">人物</option><option value="image">画像</option></select><label className="rounded-lg border border-dashed px-3 py-2 text-center text-sm">{card.imageUrl ? '画像設定済み' : '画像を選択'}<input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { const f=e.target.files?.[0]; if(f) void upload(f,index) }}/></label><input value={card.title} onChange={(e) => setCards((all) => all.map((c,i) => i===index ? {...c,title:e.target.value}:c))} placeholder="タイトル" className="rounded-lg border px-3 py-2 text-sm"/><input value={card.description} onChange={(e) => setCards((all) => all.map((c,i) => i===index ? {...c,description:e.target.value}:c))} placeholder="説明" className="rounded-lg border px-3 py-2 text-sm"/><input value={card.actionLabel} onChange={(e) => setCards((all) => all.map((c,i) => i===index ? {...c,actionLabel:e.target.value}:c))} placeholder="ボタン名" className="rounded-lg border px-3 py-2 text-sm"/><input value={card.actionUrl} onChange={(e) => setCards((all) => all.map((c,i) => i===index ? {...c,actionUrl:e.target.value}:c))} placeholder="アクションURL" className="rounded-lg border px-3 py-2 text-sm"/></div></div>)}<button disabled={cards.length >= MAX_PANELS} onClick={() => setCards((all) => [...all,newCard()])} className="w-full rounded-xl border border-dashed py-3 text-sm font-bold text-emerald-700 disabled:text-slate-400">＋ パネルを追加（{cards.length}/{MAX_PANELS}）</button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked readOnly />末尾に「もっと見る」パネルを表示</label></div>}
      {(kind === 'coupon' || kind === 'research') && <><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'coupon' ? '特典内容・利用条件' : 'アンケートの説明'} className="w-full rounded-xl border p-3 text-sm" rows={3}/><input value={actionUrl} onChange={(e) => setActionUrl(e.target.value)} placeholder={kind === 'coupon' ? 'クーポンを開くURL' : '回答フォームURL'} className="w-full rounded-xl border px-3 py-2.5 text-sm" /></>}
      {error && <p className="text-sm text-rose-600">{error}</p>}<div className="flex justify-end gap-2"><button onClick={reset} className="rounded-lg border px-4 py-2 text-sm">キャンセル</button><button disabled={saving} onClick={() => void save()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div></div>
    </section>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{meta.title}</span><h3 className="mt-3 truncate font-bold text-slate-900">{item.name}</h3><p className="mt-1 text-xs text-slate-500">更新 {new Date(item.updatedAt).toLocaleString('ja-JP')}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><a href={`/broadcasts/new?contentTemplateId=${encodeURIComponent(item.id)}`} className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700">一斉配信で使う</a><button onClick={() => startEdit(item)} className="min-w-24 flex-1 rounded-lg border px-3 py-2 text-sm font-bold">編集</button><button onClick={() => { setDeleteError(''); setDeleteTarget({ item, accountId: selectedAccountId }) }} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-600">削除</button></div></article>)}{items.length === 0 && <div className="col-span-full rounded-2xl border border-dashed bg-white p-12 text-center text-sm text-slate-500">まだ{meta.singular}テンプレートがありません。「新規作成」から追加してください。</div>}</div>

    {/*
      取り消せない操作なので `destructive` を付ける。消したテンプレートは
      戻せない（DBの行を消すだけで、控えは残らない）。
    */}
    <ConfirmDialog
      open={deleteTarget !== null}
      title={deleteTarget ? `「${deleteTarget.item.name}」を削除しますか？` : ''}
      description={`この${meta.singular}テンプレートを一覧から削除します。この操作は取り消せません。`}
      confirmLabel="削除する"
      destructive
      busy={deleting}
      error={
        accountSwitched
          ? '窓を開けたあとにLINEアカウントが切り替わりました。いまの一覧には、この削除対象は含まれていません。閉じてから選び直してください。'
          : deleteError
      }
      // 切り替わったら消させない。押し口ごと出さないので、押せるように見えて
      // 何も起きない形にならない。
      onConfirm={accountSwitched ? undefined : () => void confirmDelete()}
      onCancel={closeDelete}
    >
      <ul className="text-ink-secondary space-y-1.5 text-xs leading-5">
        <li>・止まること: 一斉配信の作成画面から、この{meta.singular}を引用できなくなります。</li>
        {/* 作成画面は選んだ時点で中身を写している（broadcast-form の
            contentTemplateToBubble）。あとから参照し直していないので、
            作成済み・送信済みの配信は動かない。 */}
        <li>・残ること: すでに作った一斉配信は、引用した時点の内容を写して持っています。消しても中身は変わりません。</li>
        {/* 削除するのは broadcast_message_assets の行だけ。R2 の画像は消えない。 */}
        <li>・残ること: アップロードした画像そのものは残ります。この操作では消えません。</li>
        <li>・戻せません: 同じ{meta.singular}が必要になったときは、作り直してください。</li>
      </ul>
    </ConfirmDialog>
  </div>
}
