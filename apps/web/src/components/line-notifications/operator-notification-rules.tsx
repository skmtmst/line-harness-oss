'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, Search } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api } from '@/lib/api'
import type { NotificationRule } from '@line-crm/shared'

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'

type DraftConditions = {
  importance?: string
  recipientLabel?: string
  scheduleLabel?: string
  dedupeMinutes?: number
}

const EVENT_LABELS: Record<string, string> = {
  message_received: '受信箱に届いたとき',
  friend_add: '友だちが追加されたとき',
  cv_fire: '成果が記録されたとき',
  'incoming_webhook.custom': '外部連携のイベントを受け取ったとき',
}

function conditionsOf(rule: NotificationRule): DraftConditions {
  return rule.conditions as DraftConditions
}

function channelLabel(channels: string[]): string {
  const labels = channels.flatMap((channel) => {
    if (channel === 'dashboard') return ['管理画面']
    if (channel === 'email') return ['メール']
    if (channel === 'line') return ['LINE']
    return []
  })
  return labels.length > 0 ? labels.join('・') : '—'
}

export default function OperatorNotificationRules({ lineAccountId }: { lineAccountId: string | null }) {
  const [rules, setRules] = useState<NotificationRule[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'missing'>('all')

  const load = useCallback(async () => {
    if (!lineAccountId) {
      setRules([])
      setState('ready')
      return
    }
    setState('loading')
    try {
      const result = await api.notifications.rules.list(lineAccountId)
      if (!result.success) throw new Error('load failed')
      setRules(result.data)
      setState('ready')
    } catch (error) {
      setRules([])
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [lineAccountId])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return rules.filter((rule) => {
      const conditions = conditionsOf(rule)
      const missingRecipient = !conditions.recipientLabel
      if (filter === 'draft' && rule.isActive) return false
      if (filter === 'missing' && !missingRecipient) return false
      if (!normalized) return true
      return [rule.name, EVENT_LABELS[rule.eventType] ?? rule.eventType, conditions.recipientLabel]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized))
    })
  }, [filter, query, rules])

  const recipientCount = rules.filter((rule) => Boolean(conditionsOf(rule).recipientLabel)).length
  const missingRecipientCount = rules.length - recipientCount
  const filterCountsAvailable = Boolean(lineAccountId) && state === 'ready'

  return (
    <section data-design-node="DpxOK" className="space-y-4">
      <NoteBar>
        この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。
      </NoteBar>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="保存したお知らせ" value={state === 'ready' ? rules.length : null} unit="件" detail="現在はすべて下書きです" variant="v6" />
        <SummaryCard title="受け取る人を設定済み" value={state === 'ready' ? recipientCount : null} unit="件" detail="チーム・担当者の接続前です" variant="v6" />
        <SummaryCard title="今日届いた数" value={null} unit="件" detail="送信処理を接続後に表示" variant="v6" />
        <SummaryCard title="受け取る人がいない" value={state === 'ready' ? missingRecipientCount : null} unit="件" detail="0件と未取得を分けています" badge={missingRecipientCount > 0 ? '要確認' : undefined} badgeTone="danger" variant="v6" />
      </div>

      <div className="border-warning bg-warning-bg text-warning flex items-start gap-2 rounded-control border px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" size={17} />
        <p>既存の通知ルールを安全な下書きとして保存できます。受け取る人の解決と送信処理が接続されるまで、公開やテスト送信はできません。</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button href="/line-notifications/operator/new" variant="primary">
          <Plus aria-hidden="true" size={16} />
          運用者へのお知らせを作る
        </Button>
        <span className="text-ink-faint text-xs">CSVは実行記録を接続してから利用できます。</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="border-hairline bg-canvas flex min-w-72 max-w-md flex-1 items-center gap-2 rounded-control border px-3 py-2">
          <Search aria-hidden="true" size={17} className="text-ink-faint" />
          <span className="sr-only">お知らせを検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="お知らせ名・きっかけで探す" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        {([
          ['all', `すべて ${filterCountsAvailable ? rules.length : '—'}`],
          ['draft', `下書き ${filterCountsAvailable ? rules.filter((rule) => !rule.isActive).length : '—'}`],
          ['missing', `受け取る人がいない ${filterCountsAvailable ? missingRecipientCount : '—'}`],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input className="peer sr-only" type="radio" name="operator-notification-filter" value={value} checked={filter === value} onChange={() => setFilter(value)} />
            <span className="border-hairline bg-canvas text-ink-secondary inline-flex min-h-9 cursor-pointer items-center rounded-pill border px-3 text-xs font-semibold peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {label}
            </span>
          </label>
        ))}
      </div>

      {!lineAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="選択したアカウントごとに、運用者へのお知らせを分けて管理します。" />
      ) : state === 'loading' ? (
        <ListState kind="loading" title="運用者へのお知らせを読み込んでいます" />
      ) : state === 'error' ? (
        <ListState kind="error" title="運用者へのお知らせを表示できませんでした" onRetry={() => void load()} />
      ) : state === 'forbidden' ? (
        <ListState kind="forbidden" />
      ) : rules.length === 0 ? (
        <ListState kind="empty" title="運用者へのお知らせがまだありません" description="まず下書きを作り、受け取る人と送信処理を接続します。" action={<Button href="/line-notifications/operator/new" variant="primary">運用者へのお知らせを作る</Button>} />
      ) : visible.length === 0 ? (
        <ListState kind="empty" title="条件に合うお知らせはありません" description="検索語か絞り込みを変えてください。" />
      ) : (
        <DataTable>
          <thead><tr><Th>お知らせ</Th><Th>きっかけ</Th><Th>受け取る人</Th><Th>送る時間</Th><Th>状態</Th></tr></thead>
          <tbody>{visible.map((rule) => {
            const conditions = conditionsOf(rule)
            return (
              <Tr key={rule.id}>
                <NameCell name={<span title={rule.name}>{rule.name}</span>} sub={channelLabel(rule.channels)} />
                <Td><span className="block truncate" title={EVENT_LABELS[rule.eventType] ?? rule.eventType}>{EVENT_LABELS[rule.eventType] ?? '接続先を確認してください'}</span></Td>
                <Td><span className={conditions.recipientLabel ? 'text-ink-secondary' : 'font-semibold text-warning'}>{conditions.recipientLabel ?? 'まだ決めていません'}</span></Td>
                <Td>{conditions.scheduleLabel ?? 'いつでも'}</Td>
                <Td><span className="bg-canvas-sunken text-ink-secondary inline-flex rounded-pill px-2 py-1 text-xs font-semibold">下書き</span></Td>
              </Tr>
            )
          })}</tbody>
        </DataTable>
      )}
    </section>
  )
}
