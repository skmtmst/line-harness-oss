'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import {
  api,
  type BroadcastBubble,
  type BroadcastBubbleType,
  type BroadcastMessageAsset,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface BroadcastFormProps { tags: Tag[]; onSuccess: () => void; onCancel: () => void }

const TYPE_LABELS: Record<BroadcastBubbleType, string> = {
  text: 'テキスト', sticker: 'スタンプ', image: '写真', rich_message: 'リッチメッセージ',
  rich_video: 'リッチビデオ', video: '動画', card_message: 'カードタイプ', coupon: 'クーポン', research: 'リサーチ',
}
const EMOJIS = ['😊', '✨', '🎉', '🐕', '🐈', '🌿', '❤️', '👍']

function emptyBubble(type: BroadcastBubbleType = 'text'): BroadcastBubble {
  const content: Record<string, unknown> = type === 'text' ? { text: '' }
    : type === 'sticker' ? { packageId: 'placeholder', stickerId: 'placeholder' }
    : type === 'image' ? { originalContentUrl: '', previewImageUrl: '' }
    : type === 'video' ? { originalContentUrl: '', previewImageUrl: '' }
    : type === 'rich_video' ? { originalContentUrl: '', previewImageUrl: '', actionUrl: '' }
    : { assetId: '', assetName: '' }
  return { id: crypto.randomUUID(), type, content }
}

function MediaUpload({ bubble, onChange }: { bubble: BroadcastBubble; onChange: (content: Record<string, unknown>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isVideo = bubble.type === 'video' || bubble.type === 'rich_video'
  const upload = async (file: File) => {
    const allowed = isVideo ? ['video/mp4'] : ['image/jpeg', 'image/png']
    const max = isVideo ? 200 * 1024 * 1024 : 10 * 1024 * 1024
    if (!allowed.includes(file.type)) { setError(isVideo ? 'MP4のみ対応しています' : 'JPEG・PNGのみ対応しています'); return }
    if (file.size > max) { setError(isVideo ? '200MB以下にしてください' : '10MB以下にしてください'); return }
    setBusy(true); setError('')
    try {
      const res = await api.broadcastMessageAssets.upload(file)
      if (!res.success) { setError(res.error); return }
      onChange({ ...bubble.content, originalContentUrl: res.data.url, previewImageUrl: isVideo ? (bubble.content.previewImageUrl ?? '') : res.data.url })
    } catch { setError('アップロードに失敗しました') } finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500 hover:border-emerald-400">
      <span className="font-semibold text-slate-700">{busy ? 'アップロード中…' : `${isVideo ? 'MP4動画' : 'JPEG / PNG画像'}を選択`}</span>
      <span className="mt-1 text-xs">上限 {isVideo ? '200MB' : '10MB'}</span>
      <input type="file" className="hidden" disabled={busy} accept={isVideo ? 'video/mp4' : 'image/jpeg,image/png'} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
    </label>
    {typeof bubble.content.originalContentUrl === 'string' && bubble.content.originalContentUrl && <p className="truncate text-xs text-emerald-700">アップロード済み：{bubble.content.originalContentUrl}</p>}
    {isVideo && <input value={String(bubble.content.previewImageUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, previewImageUrl: e.target.value })} placeholder="プレビュー画像URL（任意）" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
    {bubble.type === 'rich_video' && <input value={String(bubble.content.actionUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, actionUrl: e.target.value })} placeholder="再生終了後に開くURL" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
    {error && <p className="text-xs text-rose-600">{error}</p>}
  </div>
}

function BubblePreview({ bubble }: { bubble: BroadcastBubble }) {
  const text = String(bubble.content.text ?? '')
  const imageUrl = String(bubble.content.previewImageUrl ?? bubble.content.imageUrl ?? '')
  if (bubble.type === 'text') return <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[13px] shadow-sm">{text || 'テキストを入力すると表示されます'}</div>
  if (bubble.type === 'sticker') return <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-amber-100 text-4xl">😊</div>
  if (bubble.type === 'image') return imageUrl ? <img src={imageUrl} alt="写真プレビュー" className="max-h-52 w-[82%] rounded-2xl object-cover" /> : <div className="flex h-36 w-[82%] items-center justify-center rounded-2xl bg-slate-200 text-sm text-slate-500">写真</div>
  if (bubble.type === 'video' || bubble.type === 'rich_video') return <div className="relative flex h-40 w-[82%] items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-white"><span className="text-4xl">▶</span><span className="absolute bottom-2 left-3 text-xs">{bubble.type === 'rich_video' ? 'リッチビデオ' : '動画'}</span></div>
  if (bubble.type === 'card_message') {
    const cards = Array.isArray(bubble.content.cards) ? bubble.content.cards as Array<Record<string, unknown>> : [{ title: bubble.content.assetName ?? 'カード' }]
    return <div className="flex w-full gap-2 overflow-x-auto pb-1">{cards.map((card, index) => <div key={index} className="w-36 shrink-0 rounded-xl bg-white p-2 shadow">{card.imageUrl ? <img src={String(card.imageUrl)} alt="" className="h-20 w-full rounded-lg object-cover" /> : <div className="h-20 rounded-lg bg-slate-200"/>}<p className="mt-2 truncate text-xs font-bold">{String(card.title ?? 'カード')}</p><button className="mt-2 w-full rounded bg-emerald-500 py-1 text-[10px] text-white">{String(card.actionLabel ?? '詳しく見る')}</button></div>)}</div>
  }
  return <div className="w-[82%] overflow-hidden rounded-2xl bg-white shadow-sm">{imageUrl && <img src={imageUrl} alt="素材プレビュー" className="h-32 w-full object-cover" />}<div className="p-3"><p className="text-xs font-bold">{String(bubble.content.assetName ?? TYPE_LABELS[bubble.type])}</p><p className="mt-1 text-[11px] text-slate-500">{TYPE_LABELS[bubble.type]}のプレビュー</p></div></div>
}

function BubbleEditor({ bubble, index, total, assets, onChange, onMove, onDelete }: {
  bubble: BroadcastBubble; index: number; total: number; assets: BroadcastMessageAsset[];
  onChange: (bubble: BroadcastBubble) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void
}) {
  const availableAssets = assets.filter((asset) => asset.kind === bubble.type)
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{index + 1}</span>
      <select value={bubble.type} onChange={(e) => onChange(emptyBubble(e.target.value as BroadcastBubbleType))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold">
        {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="h-9 w-9 rounded-lg border disabled:opacity-30" aria-label="上へ移動">↑</button>
      <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="h-9 w-9 rounded-lg border disabled:opacity-30" aria-label="下へ移動">↓</button>
      <button type="button" disabled={total === 1} onClick={onDelete} className="h-9 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-600 disabled:opacity-30">削除</button>
    </div>
    <div className="p-4">
      {bubble.type === 'text' && <div>
        <textarea rows={6} maxLength={500} value={String(bubble.content.text ?? '')} onChange={(e) => onChange({ ...bubble, content: { text: e.target.value } })} placeholder="テキストを入力" className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm focus:border-emerald-500 focus:outline-none" />
        <div className="mt-2 flex items-center justify-between"><div className="flex gap-1">{EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => onChange({ ...bubble, content: { text: `${String(bubble.content.text ?? '')}${emoji}`.slice(0, 500) } })} className="rounded border px-1.5 py-1 text-sm">{emoji}</button>)}</div><span className="text-xs font-semibold text-slate-500">{String(bubble.content.text ?? '').length}/500</span></div>
      </div>}
      {bubble.type === 'sticker' && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">スタンプ（準備中）</p><p className="mt-1 text-xs">packageId / stickerId を保持するデータ構造は実装済みです。現在はプレースホルダを表示します。</p></div>}
      {['image','video','rich_video'].includes(bubble.type) && <MediaUpload bubble={bubble} onChange={(content) => onChange({ ...bubble, content })} />}
      {['rich_message','card_message','coupon','research'].includes(bubble.type) && <div>
        <label className="mb-1 block text-xs font-bold text-slate-600">作成済み素材から選択</label>
        <select value={String(bubble.content.assetId ?? '')} onChange={(e) => { const asset = availableAssets.find((item) => item.id === e.target.value); onChange({ ...bubble, content: asset ? { assetId: asset.id, assetName: asset.name, ...asset.payload } : { assetId: '', assetName: '' } }) }} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="">素材を選択してください</option>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        {availableAssets.length === 0 && <p className="mt-2 text-xs text-amber-700">先に上部の素材管理タブから作成してください。</p>}
      </div>}
    </div>
  </section>
}

export default function BroadcastForm({ tags, onSuccess, onCancel }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  const createIdempotencyKey = useRef(crypto.randomUUID())
  const [title, setTitle] = useState('')
  const [bubbles, setBubbles] = useState<BroadcastBubble[]>([emptyBubble()])
  const [assets, setAssets] = useState<BroadcastMessageAsset[]>([])
  const [targetMode, setTargetMode] = useState<'all' | 'filter'>('all')
  const [filter, setFilter] = useState({ gender: '', age: '', area: '', tenure: '', reaction: '', tagId: '' })
  const [targetCount, setTargetCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  // 送る前の確認。押すまで走らせない。入力のたびに投げると、
  // 書いている途中の本文で「二重送信では」と言われ続ける。
  const [preflight, setPreflight] = useState<{
    audienceCount: number
    warnings: Array<{ level: 'info' | 'warning'; message: string }>
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { api.broadcastMessageAssets.list({ accountId: selectedAccountId || undefined }).then((r) => { if (r.success) setAssets(r.data) }).catch(() => undefined) }, [selectedAccountId])
  const countRules = useMemo(() => {
    const rules: Array<{ type: 'is_following' | 'tag_exists' | 'metadata_equals'; value: boolean | string | { key: string; value: string } }> = [{ type: 'is_following', value: true }]
    if (targetMode === 'filter') {
      if (filter.tagId) rules.push({ type: 'tag_exists', value: filter.tagId })
      for (const [key, value] of Object.entries(filter)) if (key !== 'tagId' && value) rules.push({ type: 'metadata_equals', value: { key, value } })
    }
    return rules
  }, [filter, targetMode])
  const refreshCount = useCallback(async () => {
    setCounting(true)
    try { const res = await api.segments.count({ operator: 'AND', rules: countRules }, selectedAccountId || undefined); setTargetCount(res.success ? (res.count ?? 0) : null) }
    catch { setTargetCount(null) } finally { setCounting(false) }
  }, [countRules, selectedAccountId])
  useEffect(() => { const timer = setTimeout(() => void refreshCount(), 350); return () => clearTimeout(timer) }, [refreshCount])

  const updateBubble = (index: number, bubble: BroadcastBubble) => setBubbles((items) => items.map((item, i) => i === index ? { ...bubble, id: item.id } : item))
  const moveBubble = (index: number, direction: -1 | 1) => setBubbles((items) => { const next = [...items]; const [item] = next.splice(index, 1); next.splice(index + direction, 0, item); return next })
  const validate = () => {
    if (!title.trim()) return '管理用タイトルを入力してください'
    for (const [index, bubble] of bubbles.entries()) {
      if (bubble.type === 'text' && !String(bubble.content.text ?? '').trim()) return `吹き出し${index + 1}のテキストを入力してください`
      if (['image','video','rich_video'].includes(bubble.type) && !bubble.content.originalContentUrl) return `吹き出し${index + 1}のファイルをアップロードしてください`
      if (['rich_message','card_message','coupon','research'].includes(bubble.type) && !bubble.content.assetId) return `吹き出し${index + 1}の素材を選択してください`
    }
    return ''
  }
  const runPreflight = async () => {
    setChecking(true)
    setError('')
    try {
      const first = bubbles[0]
      const content = first?.type === 'text' ? String(first.content.text ?? '') : ''
      const res = await api.broadcasts.preflight({
        targetType: filter.tagId ? 'tag' : 'all',
        targetTagId: filter.tagId || null,
        lineAccountId: selectedAccountId || null,
        messageContent: content,
      })
      if (res.success) setPreflight(res.data)
      else setError(res.error)
    } catch {
      setError('確認できませんでした')
    } finally {
      setChecking(false)
    }
  }

  const save = async () => {
    const validationError = validate(); if (validationError) { setError(validationError); return }
    setSaving(true); setError('')
    const first = bubbles[0]
    const legacyContent = first.type === 'text' ? String(first.content.text) : JSON.stringify(first.content)
    try {
      const res = await api.broadcasts.create({ title: title.trim(), messageType: first.type === 'image' ? 'image' : first.type === 'rich_message' || first.type === 'card_message' ? 'flex' : 'text', messageContent: legacyContent, messageBubbles: bubbles, targetType: filter.tagId ? 'tag' : 'all', targetTagId: filter.tagId || null, lineAccountId: selectedAccountId || null, scheduledAt: null, trackLinks: true }, { idempotencyKey: createIdempotencyKey.current })
      if (res.success) onSuccess(); else setError(res.error)
    } catch { setError('下書きを保存できませんでした') } finally { setSaving(false) }
  }

  return <div className="mb-8">
    <div className="mb-4 flex items-start justify-between"><div><h2 className="text-2xl font-bold text-slate-900">メッセージを作成</h2><p className="mt-1 text-sm text-slate-500">最大3つの吹き出しを、実際の表示を見ながら作成できます。</p></div><button onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">一覧に戻る</button></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block text-sm font-bold text-slate-700">管理用タイトル</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">配信先</p><div className="mt-2 flex gap-2">{(['all','filter'] as const).map((mode) => <button key={mode} onClick={() => setTargetMode(mode)} className={`rounded-full px-4 py-2 text-sm font-semibold ${targetMode === mode ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{mode === 'all' ? 'すべての友だち' : '絞り込み'}</button>)}</div></div><div className="rounded-xl bg-emerald-50 px-5 py-3 text-right"><p className="text-xs font-bold text-emerald-700">送信対象</p><p className="text-2xl font-black text-emerald-700">{counting ? '…' : targetCount?.toLocaleString('ja-JP') ?? '-'}<span className="ml-1 text-sm">人</span></p></div></div>
          {targetMode === 'filter' && <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <select value={filter.tagId} onChange={(e) => setFilter({ ...filter, tagId: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">タグ：すべて</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
            <select value={filter.gender} onChange={(e) => setFilter({ ...filter, gender: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">性別：すべて</option><option value="female">女性</option><option value="male">男性</option><option value="unknown">未設定</option></select>
            <select value={filter.age} onChange={(e) => setFilter({ ...filter, age: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">年代：すべて</option>{['20代','30代','40代','50代','60代以上'].map((v) => <option key={v}>{v}</option>)}</select>
            <input value={filter.area} onChange={(e) => setFilter({ ...filter, area: e.target.value })} placeholder="エリア（例：東京都）" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={filter.tenure} onChange={(e) => setFilter({ ...filter, tenure: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">友だち期間：すべて</option><option value="0-30">30日以内</option><option value="31-180">31〜180日</option><option value="181+">181日以上</option></select>
            <select value={filter.reaction} onChange={(e) => setFilter({ ...filter, reaction: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">過去反応：すべて</option><option value="clicked">クリックあり</option><option value="replied">返信あり</option></select>
          </div>}
        </section>
        {bubbles.map((bubble, index) => <BubbleEditor key={bubble.id} bubble={bubble} index={index} total={bubbles.length} assets={assets} onChange={(next) => updateBubble(index, next)} onMove={(direction) => moveBubble(index, direction)} onDelete={() => setBubbles((items) => items.filter((_, i) => i !== index))} />)}
        <button type="button" disabled={bubbles.length >= 3} onClick={() => setBubbles((items) => [...items, emptyBubble()])} className="w-full rounded-2xl border-2 border-dashed border-emerald-300 py-4 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">＋ 吹き出しを追加（{bubbles.length}/3）</button>
        {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {preflight && (
      <div className="border-hairline mb-3 rounded-xl border p-4">
        <p className="text-ink-secondary text-sm font-bold">
          送る前の確認：{preflight.audienceCount.toLocaleString('ja-JP')} 人に届きます
        </p>
        {preflight.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {preflight.warnings.map((w) => (
              <li
                key={w.message}
                className={`rounded px-2 py-1 text-xs ${
                  w.level === 'warning' ? 'bg-danger-bg text-danger' : 'bg-info-bg text-info'
                }`}
              >
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
    <div className="flex justify-end gap-3"><button onClick={onCancel} className="rounded-xl border px-5 py-3 text-sm font-bold">キャンセル</button><button disabled={checking} onClick={() => void runPreflight()} className="rounded-xl border px-5 py-3 text-sm font-bold disabled:opacity-50">{checking ? '確認中…' : '配信前チェック'}</button><button disabled={saving} onClick={() => void save()} className="rounded-xl bg-emerald-600 px-7 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '下書きを保存'}</button></div>
      </div>
      <aside className="xl:sticky xl:top-6 xl:h-fit"><div className="overflow-hidden rounded-[28px] border-[8px] border-slate-800 bg-[#8faed2] shadow-xl"><div className="bg-slate-800 px-4 py-2 text-center text-xs font-bold text-white">トークプレビュー</div><div className="flex min-h-[600px] flex-col gap-3 p-4"><p className="mb-3 text-center text-[11px] text-white/80">今日</p>{bubbles.map((bubble) => <BubblePreview key={bubble.id} bubble={bubble} />)}</div></div><p className="mt-3 text-center text-xs text-slate-500">編集内容がリアルタイムで反映されます</p></aside>
    </div>
  </div>
}
