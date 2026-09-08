'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api, type OperatorNotificationRule } from '@/lib/api'

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'
type DraftConditions = { recipientLabel?: string; scheduleLabel?: string }
type OperatorNotificationSummary = {
  total: number
  published: number
  stopped: number
  missingRecipients: number
  recipients: number
  acceptedToday: number
  excludedToday: number
}

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

export default function OperatorNotificationRules({ lineAccountId }: { lineAccountId: string | null }) {
  usePageTitle('運用者へのお知らせ')
  const [rules, setRules] = useState<OperatorNotificationRule[]>([])
  const [summary, setSummary] = useState<OperatorNotificationSummary | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'missing'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [exportReason, setExportReason] = useState('')
  const [showExport, setShowExport] = useState(false)

  const load = useCallback(async () => {
    if (!lineAccountId) { setRules([]); setSummary(null); setState('ready'); return }
    setState('loading')
    try {
      const result = await api.notifications.operatorRules.list(lineAccountId)
      if (!result.success) throw new Error('load failed')
      setRules(result.data.items)
      setSummary(result.data.summary)
      setState('ready')
    } catch (error) {
      setRules([])
      setSummary(null)
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

  const stop = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice('')
    try {
      await api.notifications.rules.update(rule.id, lineAccountId, { isActive: false })
      setNotice(`「${rule.name}」を止めました。`)
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '停止できませんでした。')
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
      setShowExport(false)
      setExportReason('')
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'CSVを書き出せませんでした。')
    } finally { setBusy(null) }
  }

  const listState = !lineAccountId ? 'account-required' : state === 'ready' && rules.length === 0 ? 'empty' : state === 'ready' && visible.length === 0 ? 'filtered-empty' : state

  return <section data-design-node="DpxOK" data-list-state={listState} className="space-y-4">
    <NoteBar>この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。</NoteBar>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard title="出しているお知らせ" value={state === 'ready' ? summary?.published ?? null : null} unit="件" detail={state === 'ready' ? `うち止めている ${summary?.stopped ?? '—'}` : undefined} variant="v6" />
      <SummaryCard title="受け取る人" value={state === 'ready' ? summary?.recipients ?? null : null} unit="人" detail={state === 'ready' ? `受け取れる人がいない ${summary?.missingRecipients ?? '—'}件` : undefined} variant="v6" />
      <SummaryCard title="今日届いた数" value={state === 'ready' ? summary?.acceptedToday ?? null : null} unit="件" detail="重複を除いて" variant="v6" />
      <SummaryCard title="届かなかった" value={state === 'ready' ? summary?.excludedToday ?? null : null} unit="件" detail="受け取る人がいません" badge={(summary?.excludedToday ?? 0) > 0 ? '要確認' : undefined} badgeTone="danger" variant="v6" />
    </div>

    {notice ? <p role="status" className="rounded-control border border-hairline bg-canvas px-4 py-3 text-sm text-ink-secondary">{notice}</p> : null}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button href="/line-notifications/operator/new" variant="primary"><Plus aria-hidden="true" size={16} />運用者へのお知らせを作る</Button>
      <Button onClick={() => setShowExport(true)} disabled={!lineAccountId}><Download aria-hidden="true" size={15} />CSVで書き出す</Button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-72 max-w-md flex-1 items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-2"><Search aria-hidden="true" size={17} className="text-ink-faint" /><span className="sr-only">お知らせを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="お知らせ名・きっかけで探す" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      {(['all', 'published', 'draft', 'missing'] as const).map((value) => <label key={value}><input className="peer sr-only" type="radio" name="operator-filter" checked={filter === value} onChange={() => setFilter(value)} /><span className="inline-flex min-h-9 cursor-pointer items-center rounded-pill border border-hairline bg-canvas px-3 text-xs font-semibold text-ink-secondary peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent">{{ all: `すべて ${summary?.total ?? '—'}`, published: `出している ${summary?.published ?? '—'}`, draft: `止めている ${summary?.stopped ?? '—'}`, missing: `受け取る人がいない ${summary?.missingRecipients ?? '—'}` }[value]}</span></label>)}
      <span className="rounded-control border border-hairline bg-canvas px-3 py-2 text-xs font-semibold text-ink-secondary">よく届く順</span>
    </div>

    {!lineAccountId ? <ListState kind="empty" title="LINEアカウントを選択してください" description="選択したアカウントごとに分けて管理します。" />
      : state === 'loading' ? <ListState kind="loading" title="運用者へのお知らせを読み込んでいます" />
      : state === 'error' ? <ListState kind="error" title="運用者へのお知らせを表示できませんでした" onRetry={() => void load()} />
      : state === 'forbidden' ? <ListState kind="forbidden" />
      : rules.length === 0 ? <ListState kind="empty" title="運用者へのお知らせがまだありません" action={<Button href="/line-notifications/operator/new" variant="primary">運用者へのお知らせを作る</Button>} />
      : visible.length === 0 ? <ListState kind="empty" title="条件に合うお知らせはありません" description="検索語か絞り込みを変えてください。" />
      : <DataTable><thead><tr><Th>お知らせ</Th><Th>きっかけ</Th><Th>受け取る人</Th><Th>送る時間</Th><Th>今日</Th><Th>操作</Th></tr></thead><tbody>{visible.map((rule) => <Tr key={rule.id}>
        <NameCell name={<span title={rule.name}>{rule.name}</span>} sub={channelLabel(rule.channels)} />
        <Td>{EVENT_LABELS[rule.eventType] ?? '接続先を確認してください'}</Td>
        <Td><span className={rule.recipientCount > 0 ? 'text-ink-secondary' : 'font-semibold text-warning'}>{rule.recipientCount > 0 ? `${rule.recipientCount}人` : '受け取れる人なし'}</span></Td>
        <Td>{conditionsOf(rule).scheduleLabel ?? 'いつでも'}</Td>
        <Td>{rule.occurredToday > 0 ? `${rule.occurredToday}件` : '—'}</Td>
        <Td><div className="flex flex-wrap items-center gap-2"><Button onClick={() => void testSend(rule)} disabled={busy === rule.id}>自分にテスト</Button>{rule.status === 'draft' ? <Button variant="primary" onClick={() => void publish(rule)} disabled={busy === rule.id || rule.recipientCount === 0}>{rule.recipientCount === 0 ? '受け取る人を決める' : '公開'}</Button> : <Button onClick={() => void stop(rule)} disabled={busy === rule.id}>止める</Button>}</div></Td>
      </Tr>)}</tbody></DataTable>}
    {state === 'ready' && rules.length > 0 ? <div className="flex items-center justify-between text-xs text-ink-faint"><span>{summary?.total ?? rules.length}件中 1〜{rules.length}件</span></div> : null}
    {showExport ? <div role="dialog" aria-modal="true" aria-label="CSVを書き出す理由" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"><div className="w-full max-w-md rounded-card border border-hairline bg-canvas p-5 shadow-lg"><h2 className="font-bold text-ink">CSVを書き出す理由</h2><p className="mt-2 text-sm text-ink-secondary">個人情報を含むため、確認した目的を記録します。</p><input autoFocus value={exportReason} onChange={(event) => setExportReason(event.target.value)} className="mt-4 w-full rounded-control border border-hairline px-3 py-2 text-sm" placeholder="例：月次の運用確認" /><div className="mt-4 flex justify-end gap-2"><Button onClick={() => setShowExport(false)}>キャンセル</Button><Button variant="primary" onClick={() => void exportCsv()} disabled={!exportReason.trim() || busy === 'csv'}>書き出す</Button></div></div></div> : null}
  </section>
}
