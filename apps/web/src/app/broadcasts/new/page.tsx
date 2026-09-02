'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import type { SegmentCondition } from '@/lib/segment-condition'

function scoreRangeCondition(params: URLSearchParams): SegmentCondition | null {
  const parse = (key: 'scoreMin' | 'scoreMax') => {
    const raw = params.get(key)
    if (raw === null || !/^-?\d+$/.test(raw)) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) ? value : null
  }
  const min = parse('scoreMin')
  const max = parse('scoreMax')
  if (min === null && max === null) return null
  if (min !== null && max !== null && min > max) return null
  return { operator: 'AND', rules: [{ type: 'score_range', value: { min, max } }] }
}

/**
 * 一斉配信の作成を、URL で開けるようにする。
 *
 * 中身は一覧で使っているフォームをそのまま出す。作成の中身を2つ持つと、
 * 片方だけ直したときに食い違う。
 */
function NewBroadcastPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const initialCondition = scoreRangeCondition(new URLSearchParams(searchParams.toString()))

  const load = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setTags(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <Header title="配信を作成" description="友だちへまとめて送るメッセージを作ります。" />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/broadcasts" className="hover:underline">
          一斉配信
        </Link>
        <span className="mx-1.5">›</span>
        <span>作成</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <BroadcastForm
          tags={tags}
          onSuccess={(broadcast) => router.push(
            broadcast.status === 'scheduled'
              ? `/broadcasts/reserved?id=${encodeURIComponent(broadcast.id)}`
              : '/broadcasts',
          )}
          onCancel={() => router.push('/broadcasts')}
          openTemplatePickerInitially={searchParams.get('templatePicker') === '1'}
          initialTemplateId={searchParams.get('templateId')}
          initialContentTemplateId={searchParams.get('contentTemplateId')}
          initialCondition={initialCondition}
        />
      )}
    </div>
  )
}

export default function NewBroadcastPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewBroadcastPageContent />
    </Suspense>
  )
}
