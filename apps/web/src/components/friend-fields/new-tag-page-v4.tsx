'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import TagEditorV4, { type TagEditorValues } from './tag-editor-v4'

export default function NewTagPageV4() {
  const router = useRouter()
  const params = useSearchParams()
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void api.tagGroups.list().then((res) => res.success && setGroups(res.data))
  }, [])

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

  return (
    <TagEditorV4
      key={params.get('copy') ?? 'new'}
      mode="create"
      groups={groups}
      initialLinked={params.get('linked') === '1'}
      saving={saving}
      error={error}
      notice={notice}
      onCancel={() => router.push('/tags')}
      onSave={(values, andAnother) => save(values, andAnother)}
    />
  )
}
