'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import TagEditorV4, { type TagEditorValues } from './tag-editor-v4'

export default function NewTagPageV4() {
  usePageTitle('タグを作る')
  const router = useRouter()
  const params = useSearchParams()
  const copyId = params.get('copy') ?? ''
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [copySource, setCopySource] = useState<Tag | null>(null)
  const [loading, setLoading] = useState(Boolean(copyId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(Boolean(copyId))
    void Promise.all([
      api.tagGroups.list(),
      copyId ? api.tags.list({ withCounts: true }) : Promise.resolve(null),
    ]).then(([folders, tags]) => {
      if (cancelled) return
      if (folders.success) setGroups(folders.data)
      if (tags?.success) setCopySource(tags.data.find((item) => item.id === copyId) ?? null)
    }).catch(() => {
      if (!cancelled) setError('複製元のタグを読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [copyId])

  const save = async (values: TagEditorValues, andAnother: boolean) => {
    if (saving) return
    if (!values.name) {
      setError('タグ名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const created = await api.tags.create({ name: values.name, groupId: values.groupId || null })
      if (!created.success) throw new Error(created.error)
      if (values.isStarred) await api.tags.update(created.data.id, { isStarred: true })
      if (values.linked) {
        const mileage = await api.tags.updateMileage(created.data.id, {
          rewardMiles: values.rewardMiles,
          referralRewardMiles: values.referralRewardMiles,
          multiplierBps: values.multiplierBps,
          multiplierPriority: values.multiplierPriority,
          applyToExisting: false,
        })
        if (!mileage.success) throw new Error(mileage.error)
      }
      if (andAnother) {
        setNotice('保存しました。続けて新しいタグを作れます。')
        window.location.assign('/tags/new')
      } else {
        router.push(`/tags?highlight=${created.data.id}`)
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
      initialLinked={params.get('linked') === '1' || Boolean(copySource?.mileageReward || copySource?.referralMileageReward || copySource?.mileageMultiplierBps)}
      initialValues={copySource ? {
        name: `${copySource.name} のコピー`,
        groupId: copySource.groupId ?? '',
        isStarred: copySource.isStarred ?? false,
        linked: Boolean(copySource.mileageReward || copySource.referralMileageReward || copySource.mileageMultiplierBps),
        rewardMiles: copySource.mileageReward ?? 0,
        referralRewardMiles: copySource.referralMileageReward ?? 0,
        multiplierBps: copySource.mileageMultiplierBps ?? null,
        multiplierPriority: copySource.mileageMultiplierPriority ?? 0,
        applyToExisting: false,
        actions: [],
      } : undefined}
      saving={saving}
      error={error}
      notice={notice}
      onCancel={() => router.push('/tags')}
      onSave={(values, andAnother) => save(values, andAnother)}
    />
  )
}
