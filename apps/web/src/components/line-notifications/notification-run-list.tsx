'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

const PAGE_SIZE = 20

const STATUS_LABEL: Record<EcNotificationRun['status'], string> = {
  pending: '送信処理中',
  accepted: 'LINE API受付済み',
  excluded: '送信対象外',
  failed: '送信できませんでした',
}

const STATUS_CLASS: Record<EcNotificationRun['status'], string> = {
  pending: 'bg-warning-bg text-warning',
  accepted: 'bg-success-bg text-success',
  excluded: 'bg-canvas-sunken text-ink-faint',
  failed: 'bg-danger-bg text-danger',
}

function formatJst(value: string | null): string {
  if (!value) return '—'
  // DBの古い行はJSTの文字列をオフセット無しで持つ。端末のタイムゾーンで
  // 読み直すと時刻がずれるため、その形は「既にJST」として整形だけ行う。
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
    return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

type LoadState = 'loading' | 'ready' | 'error'

export default function NotificationRunList({
  lineAccountId,
  mode,
}: {
  lineAccountId: string | null
  mode: 'history' | 'failures'
}) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState<LoadState>('loading')
  const [result, setResult] = useState<EcNotificationRunList | null>(null)
  const [total, setTotal] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => setPage(1), [lineAccountId, mode])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (!lineAccountId) {
      setResult(null)
      setTotal(0)
      setState('ready')
      return
    }
    setState('loading')
    try {
      const response = await api.ecCommerce.notificationRuns({
        lineAccountId,
        view: mode === 'failures' ? 'failures' : 'all',
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (request !== requestRef.current) return
      if (!response.success) throw new Error('load failed')
      setResult(response.data)
      setTotal(response.pagination.total)
      setState('ready')
    } catch {
      if (request !== requestRef.current) return
      setResult(null)
      setTotal(0)
      setState('error')
    }
  }, [lineAccountId, mode, page])

  useEffect(() => { void load() }, [load])

  const title = mode === 'failures' ? '送れなかったもの' : 'お知らせの記録'
  const nodeId = mode === 'failures' ? 'X8JCA5' : 'Se65i'
  const items = result?.items ?? []
  const summary = result?.summary ?? null
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <section className="space-y-4" data-design-node={nodeId} aria-label={title}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="LINE API受付済み" value={summary?.accepted ?? null} unit="件" detail="LINEへの受付まで確認できたもの" variant="v6" loading={state === 'loading'} />
        <SummaryCard title="送信できなかった" value={summary?.failed ?? null} unit="件" detail="確認と連絡が必要なもの" variant="v6" loading={state === 'loading'} badgeTone="danger" />
        <SummaryCard title="送信対象外" value={summary?.excluded ?? null} unit="件" detail="設定により送信しなかったもの" variant="v6" loading={state === 'loading'} />
        <SummaryCard title="処理中" value={summary?.pending ?? null} unit="件" detail="受付または処理を待っているもの" variant="v6" loading={state === 'loading'} />
      </div>

      <div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
        選択中のLINEアカウントと結び付きを確認できたEC通知だけを表示します。試行回数・自動再試行・個人の既読は、現在の記録からは取得できません。
      </div>

      {!lineAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="上のアカウント切り替えから、確認するLINEアカウントを選んでください。" />
      ) : state === 'loading' ? (
        <ListState kind="loading" title={`${title}を読み込んでいます`} />
      ) : state === 'error' ? (
        <ListState
          kind="error"
          title={`${title}を表示できませんでした`}
          description="登録済みの記録は消えていません。時間をおいて読み直してください。"
          action={<Button onClick={() => void load()}>記録を再読み込み</Button>}
        />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title={mode === 'failures' ? '送れなかったお知らせはありません' : 'お知らせの記録はまだありません'}
          description={mode === 'failures' ? '現在の表示範囲には、確認が必要な失敗はありません。' : 'ECからのお知らせを処理すると、ここに記録が残ります。'}
        />
      ) : (
        <>
          <DataTable>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>お知らせ</Th>
                <Th>対象者</Th>
                <Th>状態</Th>
                <Th>受け付けた日時</Th>
                <Th>試行・クリック</Th>
                <Th>理由・対応</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <NameCell name={item.notificationName} sub={item.orderNumber ? `注文 ${item.orderNumber}` : item.source} />
                  <NameCell name={item.friendName || '名前は未取得'} sub="顧客へのお知らせ" />
                  <Td>
                    <span className={`inline-flex rounded-pill px-2 py-1 text-xs font-semibold ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </Td>
                  <Td>
                    <span className="block whitespace-nowrap text-sm">{formatJst(item.receivedAt)}</span>
                    <span className="mt-1 block whitespace-nowrap text-xs text-ink-faint">LINE受付 {formatJst(item.acceptedAt)}</span>
                  </Td>
                  <Td>
                    <span className="block text-sm">試行 {item.attemptCount === null ? '—' : `${item.attemptCount}回`}</span>
                    <span className="mt-1 block text-xs text-ink-faint">クリック {formatJst(item.clickedAt)}</span>
                  </Td>
                  <Td>
                    <span className="block text-sm leading-5 text-ink-secondary">{item.reason || '—'}</span>
                    {mode === 'failures' && item.friendId ? (
                      <Link href={`/chats?friend=${encodeURIComponent(item.friendId)}`} className="mt-1 inline-block whitespace-nowrap text-xs font-semibold text-accent hover:underline">
                        受信箱で連絡
                      </Link>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-ink-faint">
              {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件 / 全{total.toLocaleString('ja-JP')}件
            </p>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
      )}
    </section>
  )
}
