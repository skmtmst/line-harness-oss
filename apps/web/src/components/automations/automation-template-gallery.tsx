'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Tags, UserPlus } from 'lucide-react'
import { api, type AutomationTemplateSummary } from '@/lib/api'
import Button from '@/components/shared/button'
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
    try {
      const response = await api.automations.createDraftFromTemplate(item.key, accountId)
      if (!response.success) throw new Error(response.error)
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
      <div className="mb-4 rounded-v6-control border border-info bg-info-bg px-4 py-3 text-sm text-v6-ink-secondary">
        見本を選ぶと、公開されていない下書きを作ります。タグやシナリオは、次の画面でこのアカウントのものを選び直してください。
      </div>
      {actionError ? (
        <div className="mb-4 rounded-v6-control border border-v6-danger-border bg-v6-danger-bg px-4 py-3 text-sm text-v6-danger-text">
          {actionError}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {items.map((item, index) => {
          const Icon = ICONS[index % ICONS.length]
          return (
            <article key={item.key} className="rounded-v6-card border border-hairline bg-canvas p-5 shadow-v6-card">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-v6-control bg-v6-action-soft text-v6-action">
                  <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-v6-ink">{item.name}</h2>
                  <p className="mt-1 text-sm leading-6 text-v6-ink-faint">{item.description}</p>
                </div>
              </div>
              <dl className="mb-5 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                <dt className="text-v6-ink-faint">きっかけ</dt>
                <dd className="col-span-2 font-medium text-v6-ink-secondary">{item.triggerLabel}</dd>
                <dt className="text-v6-ink-faint">すること</dt>
                <dd className="col-span-2 font-medium text-v6-ink-secondary">{item.actionLabel}</dd>
              </dl>
              <Button
                variant="primary"
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
