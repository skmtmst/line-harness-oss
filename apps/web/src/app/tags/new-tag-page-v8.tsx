'use client'

/*
 * ★V8「タグを作る」（Pencil `d9xoI`）の入口。
 *
 * 読み込み・複製元の扱い・保存の動きは v7（new-tag-page-v4）と同じ。
 * 違うのは中身の部品——`TagEditorV8` を使う。
 */
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { TagGroup } from '@line-crm/shared'
import { api, type TagDefinition } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Notice from '@/components/shared/notice'
import TagEditorV8 from './tag-editor-v8'
import { definitionsForSave, linkedActionFromDefinition, type TagEditorValues } from '@/components/friend-fields/tag-editor-v4'

export default function NewTagPageV8() {
  usePageTitle('タグを作る')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const copyId = params.get('copy') ?? ''
  /* D012: 直前に作ったタグの名前。URLに残すので再読み込みでも消えない。 */
  const createdName = params.get('created') ?? ''
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [copySource, setCopySource] = useState<TagDefinition | null>(null)
  const [loading, setLoading] = useState(Boolean(copyId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /* D011: フォルダ一覧と複製元の失敗は別の理由で出す。 */
  const [copyError, setCopyError] = useState('')
  const [foldersFailed, setFoldersFailed] = useState(false)
  const [foldersReloadKey, setFoldersReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setGroups([])
      setFoldersFailed(false)
      return
    }
    setFoldersFailed(false)
    void api.tagGroups.list(selectedAccountId).then((folders) => {
      if (cancelled) return
      if (folders.success) {
        setGroups(folders.data.filter((group) => group.accountId === selectedAccountId))
      } else {
        setFoldersFailed(true)
      }
    }).catch(() => {
      if (!cancelled) setFoldersFailed(true)
    })
    return () => { cancelled = true }
  }, [selectedAccountId, foldersReloadKey])

  useEffect(() => {
    let cancelled = false
    setCopySource(null)
    setCopyError('')
    if (!copyId || !selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    void api.tags.definition(copyId, selectedAccountId).then((definition) => {
      if (cancelled) return
      if (definition?.success) setCopySource(definition.data)
      else setCopyError('複製元のタグを読み込めませんでした')
    }).catch(() => {
      if (!cancelled) setCopyError('複製元のタグを読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [copyId, selectedAccountId])

  const save = async (values: TagEditorValues, andAnother: boolean) => {
    if (saving) return
    if (!values.name) {
      setError('タグ名を入力してください')
      return
    }
    // 旧画面にあった作る前の検査を、実際に表示するこの画面へ移した。
    if (values.name.trim().length > 80) {
      setError('タグ名は80文字までで入力してください')
      return
    }
    if ([...values.name].some((ch) => { const code = ch.charCodeAt(0); return code < 32 || code === 127 })) {
      setError('タグ名に使えない文字が含まれています')
      return
    }
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const created = await api.tags.createDefinition(selectedAccountId, {
        name: values.name,
        groupId: values.groupId || null,
        isStarred: values.isStarred,
        manualAssignmentAllowed: true,
        reapplyPolicy: values.reapplyPolicy,
        linkedEnabled: values.linked,
        mileage: { self: values.rewardMiles, referrer: values.referralRewardMiles, multiplier: values.multiplierBps, priority: values.multiplierPriority },
        actions: definitionsForSave(values.actions),
      })
      if (!created.success) throw new Error(created.error)
      if (andAnother) {
        const next = new URLSearchParams()
        if (copyId) next.set('copy', copyId)
        next.set('created', values.name.trim())
        router.push(`/tags/new?${next}`)
      } else {
        router.push(`/tags?highlight=${created.data.tag.id}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-ink-faint">複製元を読み込んでいます…</p>

  return (
    <div>
      {createdName ? (
        <Notice tone="success" className="mb-4" message={`「${createdName}」を作成しました。続けて新しいタグを作れます。`} />
      ) : null}
      <TagEditorV8
        key={`${copyId || 'new'}:${createdName}`}
        mode="create"
        groups={groups}
        accountId={selectedAccountId}
        initialLinked={params.get('linked') === '1' || Boolean(copySource?.tag.linkedEnabled)}
        initialValues={copySource ? {
          name: `${copySource.tag.name} のコピー`,
          groupId: copySource.tag.groupId ?? '',
          isStarred: copySource.tag.isStarred ?? false,
          linked: Boolean(copySource.tag.linkedEnabled),
          rewardMiles: copySource.tag.mileageReward ?? 0,
          referralRewardMiles: copySource.tag.referralMileageReward ?? 0,
          multiplierBps: copySource.tag.mileageMultiplierBps ?? null,
          multiplierPriority: copySource.tag.mileageMultiplierPriority ?? 0,
          applyToExisting: false,
          reapplyPolicy: copySource.tag.reapplyPolicy ?? 'first_only',
          actions: (copySource.automation?.actions ?? []).map((action) => linkedActionFromDefinition(
            action,
            copySource.tag.linkedActions?.find((saved) => saved.id === action.id),
          )),
        } : undefined}
        referenceDrawerState={params.get('reference') === '1'}
        saving={saving}
        error={error || copyError}
        foldersFailed={foldersFailed}
        onRetryFolders={() => setFoldersReloadKey((key) => key + 1)}
        onCancel={() => router.push('/tags')}
        onSave={(values, andAnother) => save(values, andAnother)}
      />
    </div>
  )
}
