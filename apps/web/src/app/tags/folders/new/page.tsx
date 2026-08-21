'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280']

function FolderEditor() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [scope, setScope] = useState<'tag' | 'friend_field'>('tag')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editId) return
    void api.tagGroups.list().then((result) => {
      if (!result.success) return
      const group = result.data.find((item) => item.id === editId)
      if (group) { setName(group.name); setColor(group.color ?? COLORS[0]) }
    })
  }, [editId])

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true); setError('')
    try {
      if (scope === 'tag') {
        const result = editId
          ? await api.tagGroups.update(editId, { name: name.trim(), color })
          : await api.tagGroups.create({ name: name.trim(), color })
        if (!result.success) throw new Error(result.error)
      } else {
        const result = await api.folders.create({ kind: 'friend_field', name: name.trim(), color })
        if (!result.success) throw new Error(result.error)
      }
      router.push(scope === 'tag' ? '/tags' : '/tags?tab=fields')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-design="friend-attributes-folder-v4">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-[32px] font-bold tracking-tight text-ink">{editId ? 'フォルダを編集' : 'フォルダを追加'}</h1><p className="mt-1 text-sm text-ink-secondary">タグや友だち情報欄を、運用目的ごとに整理します。</p><nav className="mt-4 text-xs text-ink-faint"><Link href="/tags" className="text-action hover:underline">友だち属性</Link><span className="mx-2">›</span>{editId ? 'フォルダを編集' : 'フォルダを追加'}</nav></div><Link href="/tags" className="rounded-control border border-hairline bg-canvas px-4 py-2.5 text-sm font-medium text-ink-secondary">友だち属性へ</Link></header>
      <section className="mx-auto w-full max-w-[720px] rounded-card border border-hairline bg-canvas p-7 [box-shadow:1px_1px_1px_rgba(15,23,42,0.14)]">
        <h2 className="mb-5 text-xl font-bold text-ink">{editId ? 'フォルダを編集' : 'フォルダを追加'}</h2>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">フォルダ名 <span className="rounded bg-danger-bg px-1.5 py-0.5 text-[10px] text-danger">必須</span></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 購入" className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" /></label>
        <div className="mt-6"><p className="mb-3 text-sm font-semibold text-ink">フォルダの色</p><div className="flex flex-wrap gap-4">{COLORS.map((item) => <button key={item} type="button" aria-label={`色 ${item}`} aria-pressed={color === item} onClick={() => setColor(item)} className={`h-9 w-9 rounded-full ${color === item ? 'ring-2 ring-accent ring-offset-3' : ''}`} style={{ backgroundColor: item }} />)}</div><p className="mt-3 text-xs text-ink-faint">選んだ色は、フォルダと中に入れた属性の印に使われます。</p></div>
        {!editId && <div className="mt-7 border-t border-hairline pt-6"><p className="mb-3 text-sm font-semibold text-ink">作成する場所</p><div className="flex gap-2"><button type="button" onClick={() => setScope('tag')} className={`rounded-pill border px-4 py-2 text-sm font-medium ${scope === 'tag' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}>タグ</button><button type="button" onClick={() => setScope('friend_field')} className={`rounded-pill border px-4 py-2 text-sm font-medium ${scope === 'friend_field' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}>友だち情報欄</button></div></div>}
        <p className="mt-7 rounded-control border border-hairline bg-canvas-sunken p-4 text-xs leading-5 text-ink-secondary">フォルダをあとで削除しても、中に入れたタグや友だち情報欄は削除されず「未分類」に残ります。</p>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <div className="mt-7 flex justify-end gap-2"><button type="button" onClick={() => router.back()} className="rounded-control border border-hairline px-5 py-2.5 text-sm font-medium text-ink-secondary">キャンセル</button><button type="button" disabled={saving || !name.trim()} onClick={() => void save()} className="rounded-control bg-accent px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{saving ? '保存中…' : editId ? '保存する' : 'フォルダを追加'}</button></div>
      </section>
    </div>
  )
}

export default function NewTagFolderPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-ink-faint">読み込み中…</p>}><FolderEditor /></Suspense>
}
