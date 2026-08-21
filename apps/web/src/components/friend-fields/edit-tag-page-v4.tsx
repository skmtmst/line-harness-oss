'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import TagEditorV4, { type TagEditorValues } from './tag-editor-v4'

export function DeleteDialog({ tag, onCancel, onDelete, deleting, initialConfirmation = '' }: { tag: Tag; onCancel: () => void; onDelete: () => void; deleting: boolean; initialConfirmation?: string }) {
  const [confirmation, setConfirmation] = useState(initialConfirmation)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4">
      <section className="w-full max-w-[680px] rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">「{tag.name}」を削除しますか？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">削除すると、このタグを使っている設定と友だちへの付与状態に影響します。</p>
        <div className="mt-5 overflow-hidden rounded-control border border-hairline">
          <dl className="divide-y divide-hairline text-sm">
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">タグが付いている友だち</dt><dd className="font-bold">{tag.friendCount ?? 0}人</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">配信・シナリオなどの参照</dt><dd className="font-bold">3件</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">自動付与の参照</dt><dd className="font-bold">1件</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">連動アクション</dt><dd className="font-bold">停止</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">すでに積んだマイル</dt><dd className="font-bold">そのまま残る</dd></div>
          </dl>
        </div>
        <p className="mt-4 rounded-control border border-danger/25 bg-danger-bg p-3 text-sm font-medium leading-6 text-danger">アフィリエイトや外部連携で使用中の場合は削除できません。削除後は元に戻せません。</p>
        <label className="mt-5 block"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">確認のため「{tag.name}」と入力してください</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-danger" /></label>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary">キャンセル</button><button type="button" disabled={deleting || confirmation !== tag.name} onClick={onDelete} className="rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{deleting ? '削除中…' : 'タグを削除'}</button></div>
      </section>
    </div>
  )
}

export default function EditTagPageV4() {
  const router = useRouter()
  const params = useSearchParams()
  const tagId = params.get('id') ?? ''
  const [tag, setTag] = useState<Tag | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!tagId) { setLoading(false); return }
    setLoading(true)
    try {
      const [tags, folders] = await Promise.all([api.tags.list({ withCounts: true }), api.tagGroups.list()])
      if (folders.success) setGroups(folders.data)
      if (tags.success) setTag(tags.data.find((item) => item.id === tagId) ?? null)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [tagId])

  useEffect(() => { void load() }, [load])

  const save = async (values: TagEditorValues, _andAnother: boolean, applyRetroactive: boolean) => {
    if (!tag || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const update = await api.tags.update(tag.id, { name: values.name, isStarred: values.isStarred })
      if (!update.success) throw new Error(update.error)
      if ((tag.groupId ?? '') !== values.groupId) {
        const group = await api.tags.setGroup(tag.id, values.groupId || null)
        if (!group.success) throw new Error(group.error)
      }
      const mileage = await api.tags.updateMileage(tag.id, {
        rewardMiles: values.linked ? values.rewardMiles : 0,
        referralRewardMiles: values.linked ? values.referralRewardMiles : 0,
        multiplierBps: values.linked ? values.multiplierBps : null,
        multiplierPriority: values.linked ? values.multiplierPriority : 0,
        applyToExisting: applyRetroactive && values.applyToExisting,
      })
      if (!mileage.success) throw new Error(mileage.error)
      setNotice(mileage.data.queued > 0 ? `保存しました。${mileage.data.queued}人へ遡及反映を開始しました。` : '保存しました。')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!tag || deleting) return
    setDeleting(true)
    try {
      const result = await api.tags.delete(tag.id)
      if (!result.success) throw new Error(result.error)
      router.push('/tags')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '削除に失敗しました')
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-ink-faint">読み込み中…</p>
  if (!tag) return <div className="rounded-card border border-hairline bg-canvas p-8 text-center text-sm text-ink-faint">タグが見つかりません。<button type="button" onClick={() => router.push('/tags')} className="ml-2 text-action">一覧へ戻る</button></div>

  return (
    <>
      <TagEditorV4 key={tag.id} mode="edit" groups={groups} tag={tag} saving={saving} error={error} notice={notice} onCancel={() => router.push('/tags')} onSave={save} onDelete={() => setDeleteOpen(true)} />
      {deleteOpen && <DeleteDialog tag={tag} deleting={deleting} onCancel={() => setDeleteOpen(false)} onDelete={() => void remove()} />}
    </>
  )
}
