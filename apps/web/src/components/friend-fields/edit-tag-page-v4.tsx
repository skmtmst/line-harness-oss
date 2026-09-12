'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, type TagDefinition, type TagDependencies, type TagDeleteImpactReferences } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import TagEditorV4, { definitionsForSave, linkedActionFromDefinition, type TagEditorValues } from './tag-editor-v4'

/**
 * 一覧の `DeleteTagDialog` (`tags-page-v4.tsx`) と同じ分け方。
 *
 * - 配信・シナリオなどの参照 … 人が選んで使っているもの(11種)
 * - 自動付与の参照 … ひとりでに動くもの(7種)
 */
const MANUAL_REF_KEYS: Array<keyof TagDeleteImpactReferences> = [
  'broadcasts', 'forms', 'templates', 'richMenus', 'webinars', 'events',
  'bookingMenus', 'entryRoutes', 'trackedLinks', 'affiliateOffers', 'analyticsFunnels',
]
const AUTO_REF_KEYS: Array<keyof TagDeleteImpactReferences> = [
  'scenarios', 'autoReplies', 'savedSearches', 'automations',
  'commonActions', 'reminders', 'friendAddSettings',
]

function sumRefCounts(counts: TagDeleteImpactReferences, keys: Array<keyof TagDeleteImpactReferences>): number {
  return keys.reduce((total, key) => total + (counts[key] ?? 0), 0)
}

export function DeleteDialog({ tag, dependencies, dependenciesStatus, onCancel, onDelete, deleting, initialConfirmation = '' }: { tag: Tag; dependencies: TagDependencies | null; dependenciesStatus: 'loading' | 'ready' | 'error'; onCancel: () => void; onDelete: () => void; deleting: boolean; initialConfirmation?: string }) {
  const [confirmation, setConfirmation] = useState(initialConfirmation)
  /*
   * 参照件数は `load()` で取った実値を出す。取れていないときは `—`。
   * 0件と書くと「消しても大丈夫」と読み違える。**取れていないあいだは
   * 削除を押せなくする。** 失敗を「参照0件」と読み違えて使用中の
   * タグを消させないため(一覧の `DeleteTagDialog` と同じ作法)。
   */
  const manualRefs = dependencies ? sumRefCounts(dependencies.referenceCounts, MANUAL_REF_KEYS) : null
  const autoRefs = dependencies ? sumRefCounts(dependencies.referenceCounts, AUTO_REF_KEYS) : null
  const blocked = dependenciesStatus !== 'ready' || !dependencies
  const blockedReason = dependenciesStatus === 'loading'
    ? '影響を確認しています'
    : dependenciesStatus === 'error'
      ? '影響を確認できませんでした。開き直してください'
      : ''
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4">
      <section className="w-full max-w-[680px] rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">「{tag.name}」を削除しますか？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">削除すると、このタグを使っている設定と友だちへの付与状態に影響します。</p>
        <div className="mt-5 overflow-hidden rounded-control border border-hairline">
          <dl className="divide-y divide-hairline text-sm">
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">タグが付いている友だち</dt><dd className="font-bold">{(dependencies?.friendCount ?? tag.friendCount ?? 0).toLocaleString('ja-JP')}人</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">配信・シナリオなどの参照</dt><dd className="font-bold">{manualRefs === null ? '—' : `${manualRefs}件`}</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">自動付与の参照</dt><dd className="font-bold">{autoRefs === null ? '—' : `${autoRefs}件`}</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">連動アクション</dt><dd className="font-bold">停止</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">すでに積んだマイル</dt><dd className="font-bold">そのまま残る</dd></div>
          </dl>
        </div>
        <p className="mt-4 rounded-control border border-danger/25 bg-danger-bg p-3 text-sm font-medium leading-6 text-danger">アフィリエイトや外部連携で使用中の場合は削除できません。削除後は元に戻せません。</p>
        <label className="mt-5 block"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">確認のため「{tag.name}」と入力してください</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={blocked} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-danger disabled:bg-canvas-sunken" /></label>
        <div className="mt-6 flex items-center justify-end gap-2">{blockedReason && <p className="min-w-0 flex-1 text-xs text-ink-faint">{blockedReason}</p>}<button type="button" onClick={onCancel} className="shrink-0 rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary">キャンセル</button><button type="button" disabled={deleting || blocked || confirmation !== tag.name} onClick={onDelete} className="rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{deleting ? '削除中…' : 'タグを削除'}</button></div>
      </section>
    </div>
  )
}

/**
 * 保管済み(archived)タグの専用画面（Issue #710）。
 *
 * `TagEditorV4`（フォルダ・スター・マイル・連動アクションまで持つ通常の
 * 編集フォーム）は使わない。archived タグはサーバ側
 * （`updateTagDefinition`）が名前・説明以外の変更を拒否するため、それ以外
 * の項目を編集できるように見せても保存できず、利用者が混乱する。
 *
 * タグには archived を active に戻す口が無い（司令塔裁定・Issue #710）。
 * 戻せないので、名前・説明の訂正だけは常に許す。
 */
function ArchivedTagEditor({ tag, accountId, onCancel, onSaved }: {
  tag: Tag
  accountId: string
  onCancel: () => void
  onSaved: (updated: Tag) => void
}) {
  const [name, setName] = useState(tag.name)
  const [description, setDescription] = useState(tag.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.tags.updateArchivedNameAndDescription(tag.id, accountId, tag.version ?? 1, {
        name, description: description || null,
      })
      if (!result.success) throw new Error(result.error)
      setNotice('保存しました。')
      onSaved(result.data.tag)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 p-6">
      <div role="status" className="rounded-card border border-warning/40 bg-warning-bg p-4 text-sm text-warning">
        <p className="font-bold">このタグは保管済みです</p>
        <p className="mt-1 text-xs leading-5">保管済みのタグは、あとから元に戻す機能がありません。誤字などの表示名の訂正だけできます。フォルダ・付与のしかた・マイル・連動アクションなどの設定は変更できません。</p>
      </div>
      {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger-bg p-3 text-sm text-danger">{error}</p>}
      {notice && <p className="rounded-control border border-accent/25 bg-accent-soft p-3 text-sm text-accent">{notice}</p>}
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">タグ名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-accent" /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">説明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-accent" /></label>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? '保存中…' : '保存'}</Button>
      </div>
    </div>
  )
}

export default function EditTagPageV4() {
  usePageTitle('タグを編集')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tagId = params.get('id') ?? ''
  const retroactiveReference = params.get('visualQa') === 'retroactive'
  const [tag, setTag] = useState<Tag | null>(null)
  const [definition, setDefinition] = useState<TagDefinition | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /*
   * 削除確認に出す参照件数。`load()` で取った実値を `DeleteDialog` へ渡す。
   * 取れていないのに開いたら、窓の中は `—` で削除は押せない。
   */
  const [dependencies, setDependencies] = useState<TagDependencies | null>(null)
  const [dependenciesStatus, setDependenciesStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    if (!tagId || !selectedAccountId) { setLoading(false); return }
    setLoading(true)
    try {
      const [detail, dependenciesResult, folders] = await Promise.all([
        api.tags.definition(tagId, selectedAccountId),
        api.tags.dependencies(tagId, selectedAccountId),
        api.tagGroups.list(selectedAccountId),
      ])
      if (folders.success) setGroups(folders.data)
      if (dependenciesResult.success) {
        setDependencies(dependenciesResult.data)
        setDependenciesStatus('ready')
      } else {
        setDependencies(null)
        setDependenciesStatus('error')
      }
      if (!detail.success) throw new Error(detail.error)
      setDefinition(detail.data)
      setTag({ ...detail.data.tag, friendCount: dependenciesResult.success ? dependenciesResult.data.friendCount : detail.data.tag.friendCount })
    } catch {
      setError('読み込みに失敗しました')
      // 参照だけ取れていたのに消すと、窓が「取れていない」扱いになる。
      // 取れていた分は残し、まだ無いときだけ失敗にする。
      setDependenciesStatus((prev) => (prev === 'ready' ? prev : 'error'))
    } finally {
      setLoading(false)
    }
  }, [tagId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const save = async (values: TagEditorValues, _andAnother: boolean, applyRetroactive: boolean) => {
    if (!tag || !definition || !selectedAccountId || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const update = await api.tags.updateDefinition(tag.id, selectedAccountId, tag.version ?? 1, {
        name: values.name,
        groupId: values.groupId || null,
        isStarred: values.isStarred,
        manualAssignmentAllowed: tag.manualAssignmentAllowed ?? true,
        reapplyPolicy: values.reapplyPolicy,
        linkedEnabled: values.linked,
        mileage: { self: values.rewardMiles, referrer: values.referralRewardMiles, multiplier: values.multiplierBps, priority: values.multiplierPriority },
        actions: definitionsForSave(values.actions),
        applyToExisting: applyRetroactive && values.applyToExisting,
        automationId: definition.automation?.id ?? null,
        automationDraftVersion: definition.automation?.draftVersion?.id ?? null,
      })
      if (!update.success) throw new Error(update.error)
      setNotice(update.data.queued > 0 ? `保存しました。${update.data.queued}人へ遡及反映を開始しました。` : '保存しました。')
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
  if (!selectedAccountId) return <div role="alert" className="rounded-card border border-warning/30 bg-warning-bg p-6 text-sm text-warning">LINE公式アカウントを選んでください。</div>
  if (!tag || !definition) return <div className="rounded-card border border-hairline bg-canvas p-8 text-center text-sm text-ink-faint">タグが見つかりません。<button type="button" onClick={() => router.push('/tags')} className="ml-2 text-action">一覧へ戻る</button></div>

  // 保管済み(archived)タグは、通常の編集フォームを出さない(#710)。
  if (tag.status === 'archived') {
    return (
      <ArchivedTagEditor
        tag={tag}
        accountId={selectedAccountId}
        onCancel={() => router.push('/tags')}
        // load() は setLoading(true) を伴い、読み込み中画面がこのまま
        // 一度アンマウントされて「保存しました。」が一瞬で消える
        // （画面が全部作り直されるため）。保存直後は PATCH の戻り値で
        // その場を更新するだけにする。
        onSaved={(updated) => setTag((current) => (current ? { ...current, ...updated } : current))}
      />
    )
  }

  return (
    <>
      <TagEditorV4 key={`${tag.id}:${tag.version ?? 1}`} mode="edit" groups={groups} tag={tag} accountId={selectedAccountId} initialApplyToExisting={retroactiveReference} initialRetroactiveOpen={retroactiveReference} referenceRetroactiveState={retroactiveReference} initialValues={{ reapplyPolicy: tag.reapplyPolicy ?? 'first_only', actions: (definition.automation?.actions ?? []).map((action) => linkedActionFromDefinition(action, tag.linkedActions?.find((saved) => saved.id === action.id))) }} saving={saving} error={error} notice={notice} onCancel={() => router.push('/tags')} onSave={save} onDelete={() => setDeleteOpen(true)} />
      {deleteOpen && <DeleteDialog tag={tag} dependencies={dependencies} dependenciesStatus={dependenciesStatus} deleting={deleting} onCancel={() => setDeleteOpen(false)} onDelete={() => void remove()} />}
    </>
  )
}
