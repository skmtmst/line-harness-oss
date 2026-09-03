'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FriendAddEventAttributionStatus,
  FriendAddEventKind,
  FriendAddEventList,
  FriendAddEventRoutingStatus,
} from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import NoteBar from '@/components/shared/note-bar'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type KindFilter = 'all' | FriendAddEventKind
type AttributionFilter = 'all' | FriendAddEventAttributionStatus
type RoutingFilter = 'all' | FriendAddEventRoutingStatus

const ROUTING_LABELS: Record<FriendAddEventRoutingStatus, { label: string; tone: StatusBadgeTone }> = {
  pending: { label: '処理中です', tone: 'info' },
  completed: { label: '動きました', tone: 'success' },
  failed: { label: '確認が必要です', tone: 'danger' },
  suppressed: { label: '配信しませんでした', tone: 'neutral' },
}

/** DBにはJSTの時刻をオフセットなしで保存した古い行がある。UTCへ読み替えず、そのままJSTとして表示する。 */
function formatJstDateTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (bare && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${bare[1]}/${bare[2]}/${bare[3]} ${bare[4]}:${bare[5]}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

export default function FriendAddRunsPage() {
  usePageTitle('友だち追加時配信・実行結果')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const [kind, setKind] = useState<KindFilter>('all')
  const [attribution, setAttribution] = useState<AttributionFilter>('all')
  const [routing, setRouting] = useState<RoutingFilter>('all')
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null])
  const [data, setData] = useState<FriendAddEventList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const cursor = cursorStack[cursorStack.length - 1]

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!selectedAccountId) {
      setData(null)
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.friendAddRouting.events(selectedAccountId, {
        limit: 20,
        cursor: cursor ?? undefined,
        kind: kind === 'all' ? undefined : kind,
        attributionStatus: attribution === 'all' ? undefined : attribution,
        routingStatus: routing === 'all' ? undefined : routing,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setData(null)
        setError('実行結果を表示できませんでした。通信を確認して、もう一度お試しください。')
        return
      }
      setData(response.data)
    } catch {
      if (requestId !== requestSequence.current) return
      setData(null)
      setError('実行結果を表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [attribution, cursor, kind, routing, selectedAccountId])

  useEffect(() => {
    setCursorStack([null])
  }, [attribution, kind, routing, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const summary = data?.summary ?? null
  const selectedAccountExists = selectedAccountId && accounts.some((account) => account.id === selectedAccountId)

  return (
    <div data-design-node="P2J0Te" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-secondary">
          友だち追加を受け付けたあと、どの経路として記録し、配信したかを確認できます。
        </p>
        <Button href="/friend-add-settings">配信設定へ戻る</Button>
      </div>

      <NoteBar>
        LINE公式アカウントの通常URLや公式QRから追加された場合、正確な流入経路は取得できません。取得できない記録は0件にせず「経路は取得できません」と表示します。
      </NoteBar>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="受け付けた" value={summary?.total ?? null} unit="件" detail="選択中のアカウント" loading={loading} />
        <SummaryCard variant="v6" title="はじめて" value={summary?.firstTime ?? null} unit="件" detail="初回の友だち追加" loading={loading} />
        <SummaryCard variant="v6" title="再追加" value={summary?.returning ?? null} unit="件" detail="再追加・ブロック解除" loading={loading} />
        <SummaryCard variant="v6" title="要確認" value={summary?.failed ?? null} unit="件" detail="処理できなかった記録" loading={loading} badge={summary && summary.failed > 0 ? '要確認' : undefined} badgeTone="danger" />
      </div>

      {/*
        絞り込みは共通の `Select`（設計 `rpot9` / `Gfsb4`）。素の選び口は
        ブラウザごとに見た目が変わり、設計の選び口と別物になる。
      */}
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-hairline bg-canvas px-4 py-3">
        <Select
          aria-label="追加の種類"
          label="追加の種類"
          value={kind}
          onChange={(value) => setKind(value as KindFilter)}
          options={[
            { value: 'all', label: 'すべての追加' },
            { value: 'first_time', label: 'はじめて' },
            { value: 'returning', label: '再追加・ブロック解除' },
          ]}
        />
        <Select
          aria-label="流入経路"
          label="流入経路"
          value={attribution}
          onChange={(value) => setAttribution(value as AttributionFilter)}
          options={[
            { value: 'all', label: 'すべての経路' },
            { value: 'captured', label: '経路を取得できた' },
            { value: 'unavailable', label: '経路を取得できない' },
          ]}
        />
        <Select
          aria-label="配信・処理"
          label="配信・処理"
          value={routing}
          onChange={(value) => setRouting(value as RoutingFilter)}
          options={[
            { value: 'all', label: 'すべての結果' },
            { value: 'completed', label: '動きました' },
            { value: 'pending', label: '処理中です' },
            { value: 'failed', label: '確認が必要です' },
            { value: 'suppressed', label: '配信しませんでした' },
          ]}
        />
        <Button onClick={() => void load()} disabled={loading}>一覧を更新</Button>
      </div>

      {accountLoading || loading ? (
        <ListState kind="loading" title="実行結果を読み込んでいます" />
      ) : !selectedAccountExists ? (
        <ListState
          kind="empty"
          title={accounts.length > 0 ? 'LINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
          description={accounts.length > 0 ? '上のバーで、確認するアカウントを選んでください。' : 'アカウントを登録すると実行結果を確認できます。'}
        />
      ) : error ? (
        <ListState
          kind="error"
          title="実行結果を表示できませんでした"
          description={error}
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      ) : !data || data.items.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に合う実行結果はありません"
          description="絞り込みを変えるか、次の友だち追加を待ってください。"
        />
      ) : (
        <>
          <DataTable>
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>受信日時</Th>
                <Th>友だち</Th>
                <Th>追加の種類</Th>
                <Th>確定した流入経路</Th>
                <Th>配信・処理</Th>
                <Th>処理日時</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const status = ROUTING_LABELS[item.routingStatus]
                const routeName = item.attributionStatus === 'captured'
                  ? item.entryRouteName || item.refCode || '選択した経路'
                  : '経路は取得できません'
                return (
                  <Tr key={item.id}>
                    <Td title={formatJstDateTime(item.occurredAt)}><span className="block truncate">{formatJstDateTime(item.occurredAt)}</span></Td>
                    <NameCell
                      name={<Link className="text-accent hover:underline" href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`}>{item.displayName || '名前は未取得'}</Link>}
                      sub={item.displayName ? undefined : '友だち情報を開いて確認'}
                    />
                    <Td>{item.kind === 'first_time' ? 'はじめて' : '再追加・ブロック解除'}</Td>
                    <Td title={routeName}><span className="block truncate">{routeName}</span></Td>
                    <Td><StatusBadge tone={status.tone} size="compact">{status.label}</StatusBadge></Td>
                    <Td title={formatJstDateTime(item.processedAt)}><span className="block truncate">{formatJstDateTime(item.processedAt)}</span></Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-faint">{cursorStack.length}ページ目・このページは{data.items.length}件</p>
            <div className="flex gap-2">
              <Button
                onClick={() => setCursorStack((current) => current.length > 1 ? current.slice(0, -1) : current)}
                disabled={cursorStack.length === 1 || loading}
              >
                前へ
              </Button>
              <Button
                onClick={() => data.nextCursor && setCursorStack((current) => [...current, data.nextCursor])}
                disabled={!data.nextCursor || loading}
              >
                次へ
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
