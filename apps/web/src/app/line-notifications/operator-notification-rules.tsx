'use client'

import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import { MoreHorizontal } from 'lucide-react'

import '@/app/notifications/readonly-v8.css'
import { ReadonlyDesignNode } from '@/app/notifications/readonly-header-v8'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, Search, X } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import NoteBar from '@/components/shared/note-bar'
import KpiCard from '@/components/shared/kpi-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api, type OperatorNotificationRule } from '@/lib/api'
import ListRange from '@/components/ui/list-range'
import { operatorEventLabel } from './operator-event-options'

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


function conditionsOf(rule: OperatorNotificationRule): DraftConditions {
  return rule.conditions as DraftConditions
}

/** 板 u8xibp：行の補足は「重要度」。条件に入っている重要度を運用者の言葉へ。 */
function importanceLabelOf(rule: OperatorNotificationRule): string {
  const importance = (rule.conditions as { importance?: unknown }).importance
  if (importance === 'important') return '重要度：重要'
  if (importance === 'urgent') return '重要度：緊急'
  return '重要度：ふつう'
}

export default function OperatorNotificationRules({ lineAccountId }: { lineAccountId: string | null }) {
  usePageTitle('運用者へのお知らせ')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [rules, setRules] = useState<OperatorNotificationRule[]>([])
  const [summary, setSummary] = useState<OperatorNotificationSummary | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [exportReason, setExportReason] = useState('')
  const [showExport, setShowExport] = useState(false)
  // 書き出し中は×と同じくEscapeでも閉じない。
  const exportPanelRef = useOverlayFocus(showExport, () => setShowExport(false), busy === 'csv')

  const load = useCallback(async () => {
    if (!lineAccountId) { setRules([]); setSummary(null); setState('ready'); return }
    setState('loading')
    try {
      const result = await api.lineNotifications.operatorRules.list(lineAccountId)
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

  // 板 u8xibp：絞り込みは検索だけ。並びは「よく届く順」（今日届いた数が多い順）。
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return rules
      .filter((rule) => !normalized || [rule.name, operatorEventLabel(rule.eventType), conditionsOf(rule).recipientLabel]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized)))
      .sort((a, b) => b.occurredToday - a.occurredToday)
  }, [query, rules])

  const publish = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      await api.lineNotifications.operatorRules.publish(rule.id, lineAccountId)
      setNotice({ text: `「${rule.name}」を公開しました。`, error: false })
      await load()
    } catch (error) {
      setNotice({ text: error instanceof ApiError ? error.message : '公開できませんでした。', error: true })
    } finally { setBusy(null) }
  }

  const testSend = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      const result = await api.lineNotifications.operatorRules.test(rule.id, lineAccountId)
      if (!result.success) throw new Error(result.error)
      setNotice({ text: result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。', error: result.data.accepted === 0 })
      await load()
    } catch (error) {
      setNotice({ text: error instanceof ApiError ? error.message : 'テスト送信できませんでした。', error: true })
    } finally { setBusy(null) }
  }

  const stop = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      await api.lineNotifications.operatorRules.stop(rule.id, lineAccountId)
      setNotice({ text: `「${rule.name}」を止めました。`, error: false })
      await load()
    } catch (error) {
      setNotice({ text: error instanceof ApiError ? error.message : '停止できませんでした。', error: true })
    } finally { setBusy(null) }
  }

  const exportCsv = async () => {
    if (!lineAccountId || !exportReason.trim() || busy) return
    setBusy('csv'); setNotice(null)
    try {
      const blob = await api.lineNotifications.operatorRules.exportCsv(lineAccountId, exportReason.trim())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `operator-notifications-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice({ text: '実行記録をCSVで書き出しました。', error: false })
      setShowExport(false)
      setExportReason('')
    } catch (error) {
      setNotice({ text: error instanceof ApiError ? error.message : 'CSVを書き出せませんでした。', error: true })
    } finally { setBusy(null) }
  }

  const listState = !lineAccountId ? 'account-required' : state === 'ready' && rules.length === 0 ? 'empty' : state === 'ready' && visible.length === 0 ? 'filtered-empty' : state

  return <ReadonlyDesignNode node="u8xibp"><section data-design-node="DpxOK" data-list-state={listState} className="space-y-4">
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button onClick={() => setShowExport(true)} disabled={!lineAccountId}><Download aria-hidden="true" size={15} />CSVで書き出す</Button>
      <Button href="/line-notifications/operator/new" variant="primary"><Plus aria-hidden="true" size={16} />運用者へのお知らせを作る</Button>
    </div>
    <NoteBar>この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。</NoteBar>
    <div data-ro-kpis="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard title="出しているお知らせ" value={state === 'ready' ? summary?.published ?? null : null} unit="件" detail={state === 'ready' ? `止めている ${summary?.stopped ?? '—'}` : undefined} />
      <KpiCard title="今日届いた数" value={state === 'ready' ? summary?.acceptedToday ?? null : null} unit="件" detail="お店の人へ" />
      <KpiCard title="受け取る人" value={state === 'ready' ? summary?.recipients ?? null : null} unit="人" detail="LINEログイン済み" />
      <KpiCard title="届かなかった" value={state === 'ready' ? summary?.excludedToday ?? null : null} unit="件" detail="LINE未ログインの人" />
    </div>

    {notice ? <p role={notice.error ? 'alert' : 'status'} className="rounded-control border border-hairline bg-canvas px-4 py-3 text-sm text-ink-secondary">{notice.text}</p> : null}

    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-72 max-w-md flex-1 items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-2"><Search aria-hidden="true" size={17} className="text-ink-faint" /><span className="sr-only">お知らせを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="お知らせ名・きっかけで探す" className="min-w-0 flex-1 bg-transparent text-label outline-none" /></label>
      <Select aria-label="並び順" value="frequent" onChange={() => undefined} options={[{ value: 'frequent', label: 'よく届く順' }]} />
    </div>

    {!lineAccountId ? <ListState kind="empty" title="LINEアカウントを選択してください" description="選択したアカウントごとに分けて管理します。" />
      : state === 'loading' ? <ListState kind="loading" title="運用者へのお知らせを読み込んでいます" />
      : state === 'error' ? <ListState kind="error" title="運用者へのお知らせを表示できませんでした" onRetry={() => void load()} />
      : state === 'forbidden' ? <ListState kind="forbidden" />
      : rules.length === 0 ? <ListState kind="empty" title="運用者へのお知らせがまだありません" action={<Button href="/line-notifications/operator/new" variant="primary">運用者へのお知らせを作る</Button>} />
      : visible.length === 0 ? <ListState kind="empty" title="条件に合うお知らせはありません" description="検索語か絞り込みを変えてください。" />
      : <DataTable><thead><tr><Th>お知らせ</Th><Th>きっかけ</Th><Th>受け取る人</Th><Th>送る時間</Th><Th>今日</Th><Th>状態</Th><Th>操作</Th></tr></thead><tbody>{visible.map((rule) => <Tr key={rule.id}>
        {/* NOTIFY-04: 名前から編集画面へ戻れる。保存したお知らせを開き直して
            直せないと、直すたびに作り直しになる。 */}
        <NameCell name={<Link href={`/line-notifications/operator/new?id=${encodeURIComponent(rule.id)}`} className="text-action hover:underline" title={rule.name}>{rule.name}</Link>} sub={importanceLabelOf(rule)} />
        <Td>{operatorEventLabel(rule.eventType)}</Td>
        <Td>{conditionsOf(rule).recipientLabel ?? (rule.recipientCount > 0 ? `${rule.recipientCount}人` : '受け取れる人なし')}</Td>
        <Td>{conditionsOf(rule).scheduleLabel ?? 'いつでも'}</Td>
        <Td>{rule.occurredToday > 0 ? `${rule.occurredToday}` : '—'}</Td>
        <Td><span className={`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${rule.status === 'published' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{rule.status === 'published' ? '出している' : '止めている'}</span></Td>
        <Td><div className="flex items-center justify-end gap-2"><Button variant="secondary" size="compact" onClick={() => void testSend(rule)} disabled={busy === rule.id}>自分にテスト</Button><IconButton aria-label={`${rule.name}の操作`} aria-haspopup="menu" aria-expanded={openMenuId === rule.id} onClick={() => setOpenMenuId(openMenuId === rule.id ? null : rule.id)}><MoreHorizontal aria-hidden="true" size={16} /></IconButton><ActionMenu open={openMenuId === rule.id} onClose={() => setOpenMenuId(null)} ariaLabel={`${rule.name}の操作`} items={rule.status === 'draft' ? [{ id: 'publish', label: '公開', disabled: busy === rule.id || rule.recipientCount === 0, disabledReason: rule.recipientCount === 0 ? '受け取る人を決めてください' : undefined, onSelect: () => { setOpenMenuId(null); void publish(rule) } }] : [{ id: 'stop', label: '止める', disabled: busy === rule.id, onSelect: () => { setOpenMenuId(null); void stop(rule) } }]} /></div></Td>
      </Tr>)}</tbody></DataTable>}
    {state === 'ready' && rules.length > 0 ? <div className="flex items-center justify-between"><ListRange total={summary?.total ?? rules.length} first={1} last={rules.length} /></div> : null}
    {showExport ? <div role="dialog" aria-modal="true" aria-label="CSVを書き出す理由" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"><div ref={exportPanelRef} className="w-full max-w-md rounded-card border border-hairline bg-canvas p-5 shadow-float"><div className="flex items-start justify-between gap-3"><h2 className="font-bold text-ink">CSVを書き出す理由</h2><button type="button" onClick={() => setShowExport(false)} disabled={busy === 'csv'} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div><p className="mt-2 text-sm text-ink-secondary">個人情報を含むため、確認した目的を記録します。</p><input autoFocus value={exportReason} onChange={(event) => setExportReason(event.target.value)} className="mt-4 w-full rounded-control border border-hairline px-3 py-2 text-sm" placeholder="例：月次の運用確認" /><div className="mt-4 flex justify-end gap-2"><Button onClick={() => setShowExport(false)}>キャンセル</Button><Button variant="primary" onClick={() => void exportCsv()} disabled={!exportReason.trim() || busy === 'csv'}>書き出す</Button></div></div></div> : null}
  </section></ReadonlyDesignNode>
}
