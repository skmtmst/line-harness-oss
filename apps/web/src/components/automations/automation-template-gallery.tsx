'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Tags, UserPlus } from 'lucide-react'
import { api, type AutomationTemplateSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'

const ICONS = [UserPlus, MessageCircle, Tags] as const

export default function AutomationTemplateGallery({
  accountId,
  canManage,
}: {
  accountId: string | null
  canManage: boolean | null
}) {
  const router = useRouter()
  const [items, setItems] = useState<AutomationTemplateSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [creating, setCreating] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [triggerFilter, setTriggerFilter] = useState('すべて')
  /*
   * DETAIL-13: 「これで作る」1回の操作を識別する冪等鍵（店・見本ごと）。
   * 失敗してもう一度押す・通信がやり直されるときは同じ鍵——サーバーは
   * 同じ下書きを返すので1件に収まる。作れたあと（＝操作が終わったあと）の
   * 次の押下は別の操作なので、新しい鍵を振る。
   */
  const operationKeysRef = useRef<Record<string, string>>({})

  const triggerFilters = useMemo(
    () => ['すべて', ...Array.from(new Set(items.map((item) => item.triggerLabel)))],
    [items],
  )
  const visibleItems = useMemo(
    () => triggerFilter === 'すべて'
      ? items
      : items.filter((item) => item.triggerLabel === triggerFilter),
    [items, triggerFilter],
  )

  const load = useCallback(async () => {
    if (!accountId) {
      setItems([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const response = await api.automations.templates(accountId)
      if (!response.success) throw new Error(response.error)
      setItems(response.data)
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (item: AutomationTemplateSummary) => {
    if (!accountId || creating) return
    setCreating(item.key)
    setActionError('')
    const slot = `${accountId}:${item.key}`
    const operationKey = operationKeysRef.current[slot]
      ?? (operationKeysRef.current[slot] = crypto.randomUUID())
    try {
      const response = await api.automations.createDraftFromTemplate(item.key, accountId, operationKey)
      if (!response.success) throw new Error(response.error)
      // 操作はここで完了。次の「これで作る」は別の新規作成なので鍵を捨てる。
      delete operationKeysRef.current[slot]
      router.push(`/automations/drafts?id=${encodeURIComponent(response.data.id)}`)
    } catch {
      setActionError('下書きを作れませんでした。状態を読み直してから、もう一度お試しください。')
      setCreating(null)
    }
  }

  if (!accountId) {
    return (
      <ListState
        kind="empty"
        title="LINE公式アカウントを選んでください"
        description="見本から作る下書きは、選んだアカウントだけに保存します。"
      />
    )
  }
  if (status === 'loading') return <ListState kind="loading" title="見本を読み込んでいます" />
  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="見本を表示できませんでした"
        description="まだ下書きは作っていません。再読み込みしてから選んでください。"
        action={<Button variant="secondary" onClick={() => void load()}>見本を再読み込み</Button>}
      />
    )
  }
  if (items.length === 0) {
    return (
      <ListState
        kind="empty"
        title="いま使える見本はありません"
        description="実行まで確認できた見本だけを、ここへ表示します。"
      />
    )
  }

  return (
    <section data-design-node="WjYAC" data-automation-template-gallery="v6">
      <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm text-ink-secondary">
        見本を選ぶと、公開されていない下書きを作ります。タグやシナリオは、次の画面でこのアカウントのものを選び直してください。
      </div>
      {actionError ? (
        <div className="mb-4 rounded-control border border-status-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2" aria-label="きっかけで絞り込む">
        {triggerFilters.map((filter) => (
          <FilterChip
            key={filter}
            selected={triggerFilter === filter}
            onChange={(selected) => setTriggerFilter(selected ? filter : 'すべて')}
          >
            {filter}
          </FilterChip>
        ))}
      </div>
      {visibleItems.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に合う見本はありません"
          description="きっかけの絞り込みを変えてください。"
        />
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {visibleItems.map((item, index) => {
          const Icon = ICONS[index % ICONS.length]
          return (
            <article key={item.key} className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-soft text-action">
                  <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">{item.name}</h2>
                  <p className="mt-1 text-sm leading-6 text-ink-faint">{item.description}</p>
                </div>
              </div>
              <dl className="mb-5 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-faint">きっかけ</dt>
                <dd className="col-span-2 font-medium text-ink-secondary">{item.triggerLabel}</dd>
                <dt className="text-ink-faint">すること</dt>
                <dd className="col-span-2 font-medium text-ink-secondary">{item.actionLabel}</dd>
              </dl>
              <Button
                variant="secondary"
                className="w-full justify-center"
                disabled={creating !== null || canManage !== true}
                onClick={() => void create(item)}
              >
                {canManage === false ? '閲覧のみ' : creating === item.key ? '下書きを作っています…' : 'これで作る'}
              </Button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
