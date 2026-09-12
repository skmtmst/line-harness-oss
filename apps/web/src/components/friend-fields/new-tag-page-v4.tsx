'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { TagGroup } from '@line-crm/shared'
import { api, type TagDefinition } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import TagEditorV4, { definitionsForSave, linkedActionFromDefinition, type TagEditorValues } from './tag-editor-v4'

export default function NewTagPageV4() {
  usePageTitle('タグを作る')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const copyId = params.get('copy') ?? ''
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [copySource, setCopySource] = useState<TagDefinition | null>(null)
  const [loading, setLoading] = useState(Boolean(copyId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(Boolean(copyId))
    void Promise.all([
      api.tagGroups.list(selectedAccountId),
      copyId && selectedAccountId ? api.tags.definition(copyId, selectedAccountId) : Promise.resolve(null),
    ]).then(([folders, definition]) => {
      if (cancelled) return
      if (folders.success) setGroups(folders.data.filter((group) => group.accountId === selectedAccountId))
      if (definition?.success) setCopySource(definition.data)
    }).catch(() => {
      if (!cancelled) setError('複製元のタグを読み込めませんでした')
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
    setNotice('')
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
        setNotice('保存しました。続けて新しいタグを作れます。')
        window.location.assign('/tags/new')
      } else {
        router.push(`/tags?highlight=${created.data.tag.id}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-ink-faint">複製元を読み込んでいます…</p>

  return (
    <TagEditorV4
      key={copyId || 'new'}
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
      error={error}
      notice={notice}
      onCancel={() => router.push('/tags')}
      onSave={(values, andAnother) => save(values, andAnother)}
    />
  )
}
