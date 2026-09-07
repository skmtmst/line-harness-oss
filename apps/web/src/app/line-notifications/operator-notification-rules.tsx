'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api, type OperatorNotificationRule } from '@/lib/api'

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'
type DraftConditions = { recipientLabel?: string; scheduleLabel?: string }

const EVENT_LABELS: Record<string, string> = {
  message_received: '受信箱に届いたとき',
  friend_add: '友だちが追加されたとき',
  cv_fire: '成果が記録されたとき',
  'incoming_webhook.custom': '外部連携のイベントを受け取ったとき',
}

function conditionsOf(rule: OperatorNotificationRule): DraftConditions {
  return rule.conditions as DraftConditions
}

function channelLabel(channels: string[]): string {
  return channels.map((channel) => channel === 'dashboard' ? '管理画面' : channel === 'line' ? 'LINE' : channel === 'email' ? 'メール' : '')
    .filter(Boolean).join('・') || '—'
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function OperatorNotificationRules({ lineAccountId }: { lineAccountId: string | null }) {
  const [rules, setRules] = useState<OperatorNotificationRule[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'missing'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [exportReason, setExportReason] = useState('月次の運用確認')

  const load = useCallback(async () => {
    if (!lineAccountId) { setRules([]); setState('ready'); return }
    setState('loading')
    try {
      const result = await api.notifications.operatorRules.list(lineAccountId)
      if (!result.success) throw new Error('load failed')
      setRules(result.data.items)
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
      if (filter === 'published' && rule.status !== 'published') return false
      if (filter === 'draft' && rule.status !== 'draft') return false
      if (filter === 'missing' && rule.recipientCount > 0) return false
      return !normalized || [rule.name, EVENT_LABELS[rule.eventType] ?? rule.eventType, conditionsOf(rule).recipientLabel]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized))
    })
  }, [filter, query, rules])

  const publish = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice('')
    try {
      await api.notifications.operatorRules.publish(rule.id, lineAccountId)
      setNotice(`「${rule.name}」を公開しました。`)
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '公開できませんでした。')
    } finally { setBusy(null) }
  }

  const testSend = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice('')
    try {
      const result = await api.notifications.operatorRules.test(rule.id, lineAccountId)
      if (!result.success) throw new Error(result.error)
      setNotice(result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。')
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'テスト送信できませんでした。')
    } finally { setBusy(null) }
  }

  const exportCsv = async () => {
    if (!lineAccountId || !exportReason.trim() || busy) return
    setBusy('csv'); setNotice('')
    try {
      const blob = await api.notifications.operatorRules.exportCsv(lineAccountId, exportReason.trim())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `operator-notifications-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice('実行記録をCSVで書き出しました。')
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'CSVを書き出せませんでした。')
    } finally { setBusy(null) }
  }

  const published = rules.filter((rule) => rule.status === 'published').length
  const acceptedToday = rules.reduce((sum, rule) => sum + rule.acceptedToday, 0)
  const excludedToday = rules.reduce((sum, rule) => sum + rule.excludedToday, 0)
  const listState = !lineAccountId ? 'account-required' : state === 'ready' && rules.length === 0 ? 'empty' : state === 'ready' && visible.length === 0 ? 'filtered-empty' : state

  return <section data-design-node="DpxOK" data-list-state={listState} className="space-y-4">
    <NoteBar>この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。</NoteBar>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard title="公開中" value={state === 'ready' ? published : null} unit="件" detail="条件に合うと自動で知らせます" variant="v6" />
      <SummaryCard title="受け取れる人" value={state === 'ready' ? rules.reduce((sum, rule) => sum + rule.recipientCount, 0) : null} unit="人" detail="各お知らせの合計" variant="v6" />
      <SummaryCard title="今日届いた数" value={state === 'ready' ? acceptedToday : null} unit="件" detail="管理画面・LINE・メールの合計" variant="v6" />
      <SummaryCard title="今日届かなかった数" value={state === 'ready' ? excludedToday : null} unit="件" detail="受信設定や接続を確認" badge={excludedToday > 0 ? '要確認' : undefined} badgeTone="danger" variant="v6" />
    </div>

    {notice ? <p role="status" className="rounded-control border border-hairline bg-canvas px-4 py-3 text-sm text-ink-secondary">{notice}</p> : null}

    <div className="flex flex-wrap items-end justify-between gap-3">
      <Button href="/line-notifications/operator/new" variant="primary"><Plus aria-hidden="true" size={16} />運用者へのお知らせを作る</Button>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-ink-secondary">出力理由<input aria-label="CSVの出力理由" value={exportReason} onChange={(event) => setExportReason(event.target.value)} className="mt-1 block rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
        <Button onClick={() => void exportCsv()} disabled={!lineAccountId || !exportReason.trim() || busy === 'csv'}><Download aria-hidden="true" size={15} />実行記録をCSV出力</Button>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-72 max-w-md flex-1 items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-2"><Search aria-hidden="true" size={17} className="text-ink-faint" /><span className="sr-only">お知らせを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="お知らせ名・きっかけで探す" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      {(['all', 'published', 'draft', 'missing'] as const).map((value) => <label key={value}><input className="peer sr-only" type="radio" name="operator-filter" checked={filter === value} onChange={() => setFilter(value)} /><span className="inline-flex min-h-9 cursor-pointer items-center rounded-pill border border-hairline bg-canvas px-3 text-xs font-semibold text-ink-secondary peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent">{{ all: 'すべて', published: '公開中', draft: '下書き', missing: '宛先なし' }[value]}</span></label>)}
    </div>

    {!lineAccountId ? <ListState kind="empty" title="LINEアカウントを選択してください" description="選択したアカウントごとに分けて管理します。" />
      : state === 'loading' ? <ListState kind="loading" title="運用者へのお知らせを読み込んでいます" />
      : state === 'error' ? <ListState kind="error" title="運用者へのお知らせを表示できませんでした" onRetry={() => void load()} />
      : state === 'forbidden' ? <ListState kind="forbidden" />
      : rules.length === 0 ? <ListState kind="empty" title="運用者へのお知らせがまだありません" action={<Button href="/line-notifications/operator/new" variant="primary">運用者へのお知らせを作る</Button>} />
      : visible.length === 0 ? <ListState kind="empty" title="条件に合うお知らせはありません" description="検索語か絞り込みを変えてください。" />
      : <DataTable><thead><tr><Th>お知らせ</Th><Th>きっかけ</Th><Th>受け取る人</Th><Th>今日の実行</Th><Th>最終実行</Th><Th>状態と操作</Th></tr></thead><tbody>{visible.map((rule) => <Tr key={rule.id}>
        <NameCell name={<span title={rule.name}>{rule.name}</span>} sub={channelLabel(rule.channels)} />
        <Td>{EVENT_LABELS[rule.eventType] ?? '接続先を確認してください'}</Td>
        <Td><span className={rule.recipientCount > 0 ? 'text-ink-secondary' : 'font-semibold text-warning'}>{rule.recipientCount > 0 ? `${rule.recipientCount}人` : '受け取れる人なし'}</span></Td>
        <Td>{rule.occurredToday}回発生／{rule.acceptedToday}件受付</Td>
        <Td>{formatDate(rule.lastOccurredAt)}</Td>
        <Td><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex rounded-pill px-2 py-1 text-xs font-semibold ${rule.status === 'published' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-secondary'}`}>{rule.status === 'published' ? '公開中' : '下書き'}</span><Button onClick={() => void testSend(rule)} disabled={busy === rule.id}>自分にテスト</Button>{rule.status === 'draft' ? <Button variant="primary" onClick={() => void publish(rule)} disabled={busy === rule.id || rule.recipientCount === 0}>公開</Button> : null}</div></Td>
      </Tr>)}</tbody></DataTable>}
  </section>
}
