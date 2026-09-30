'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { api, ApiError, eventsApi, type EventListItem, type EventListSummary } from '@/lib/api'
import { clampSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@/lib/search-query'
import { withRequestTimeout } from '@/lib/request-timeout'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListToolbar from '@/components/shared/list-toolbar'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { RowActions } from '@/components/shared/row-actions'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Select from '@/components/shared/select'
// #740: bookings の EventKpi と一字一句同じだったため、機能内共有の1部品へ統合した。
import EventKpi from '@/components/events/event-kpi'
import HelpTip from '@/components/shared/help-tip'
import { daysUntilIso, eventRowState, isLowApplication, summarizeEventAttention } from './event-attention'
import { formatDateTime, formatDay } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * イベント予約（設計 V2 8-3 / node Ih3xS）。
 *
 * 以前は札を並べた形で、見出しが二重（Header と h1）に出ていた。
 * 札だと「どのイベントに承認待ちが溜まっているか」を見比べにくい。
 * 設計どおり、KPI4枚と表にした。
 */

/** 1ページに出す件数。設計の「表示 20件」に合わせる。 */
const PAGE_SIZE = 20

function formatJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return formatDateTime(iso)
}

function loadDetail(hasAccount: boolean, status: LoadStatus, readyDetail: string): string {
  if (!hasAccount) return 'アカウントを選択'
  if (status === 'loading') return '読み込み中'
  if (status === 'error') return '取得できませんでした'
  return readyDetail
}

function formatShortJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return formatDay(iso)
}

export default function EventsListPage() {
  usePageTitle('イベント予約')
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<EventListItem[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [summary, setSummary] = useState<EventListSummary | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'pending' | 'full'>('all')
  const [sort, setSort] = useState<'soon' | 'name'>('soon')
  const [page, setPage] = useState(1)
  const loadRequestRef = useRef(0)
  /*
   * R217: イベント本体の削除口。枠の削除しかなかったため、作りかけや
   * 終わったイベントを運用者自身が片付けられなかった。
   */
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [canDelete, setCanDelete] = useState(false)

  useEffect(() => {
    let active = true
    // 削除は owner/admin だけ（サーバ側も同じ権限で閉じている）。
    // staff 口が取れないときは入口を出さない（安全側）。
    void Promise.resolve(api.staff?.me?.()).then((res) => {
      if (!active || !res?.success) return
      setCanDelete(res.data.role === 'owner' || res.data.role === 'admin')
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId) {
      setItems([])
      setSummary(null)
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setItems([])
    setListTotal(0)
    setSummary(null)
    try {
      /*
       * #625: 応答なしの要求は時間切れの失敗にして、一覧を
       * 「読み込み中」のまま残さない。検索語は入力欄で上限済みだが、
       * ここでも切り詰めて送る語を確定させる。
       */
      const res = await withRequestTimeout(eventsApi.listEvents(selectedAccountId, {
        page,
        limit: PAGE_SIZE,
        q: clampSearchQuery(query.trim()) || undefined,
        filter,
        sort,
      }))
      if (requestId !== loadRequestRef.current) return
      setItems(res.items)
      setListTotal(res.total ?? res.items.length)
      setSummary(res.summary ?? null)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      setItems([])
      setListTotal(0)
      setSummary(null)
      setLoadStatus('error')
    }
  }, [selectedAccountId, page, query, filter, sort])

  useEffect(() => {
    void refresh()
    return () => {
      loadRequestRef.current += 1
    }
  }, [refresh])

  useEffect(() => {
    setPage(1)
  }, [query, filter, sort])

  const attention = useMemo(() => summarizeEventAttention(items), [items])

  async function confirmDeleteEvent() {
    if (!deleteTarget || deleteBusy || !selectedAccountId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await eventsApi.deleteEvent(selectedAccountId, deleteTarget.id)
      setDeleteTarget(null)
      await refresh()
    } catch (cause) {
      // 申込や順番待ちが残るときは 409（event_has_active_bookings）。理由だけを日本語で見せる。
      setDeleteError(
        cause instanceof ApiError && (cause.code === 'event_has_active_bookings' || cause.status === 409)
          ? '申込中・確定済みの予約、またはキャンセル待ちの人がいるため削除できません。先に申込者への対応を終えてください。'
          : '削除できませんでした。時間をおいて、もう一度お試しください。',
      )
    } finally {
      setDeleteBusy(false)
    }
  }
  /*
   * R79/R80: 数値カードは応答の全体集計（絞り込みに合う全件の今後の枠）を使う。
   * ページ内の行だけを数えると、21件目以降があるときに全体が小さく見える。
   * 古い応答には集計が無いので、そのときだけ今までどおりページ内の行で数える。
   */
  const kpi: EventListSummary = summary ?? {
    upcoming_slots: attention.upcoming.length,
    upcoming_active: attention.applied,
    upcoming_capacity: attention.capacity,
    fill_rate: attention.fillRate,
    nearly_full: attention.nearlyFull.length,
    low_applications: attention.lowApplications.length,
    nearest_upcoming_starts_at: attention.upcoming[0]?.next_slot_starts_at ?? null,
    nearest_low_starts_at: attention.lowApplications[0]?.next_slot_starts_at ?? null,
  }

  const pageCount = Math.max(1, Math.ceil(listTotal / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  /*
    **アカウントを選んでいないときも「取れた」にしない。** 選ぶ前は
    そもそも数える対象が無い。`ready` だけを見ると 0件と出る。
  */
  const dataReady = Boolean(selectedAccountId) && loadStatus === 'ready'

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Head">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="text-ink-faint text-xs">
            <span className="text-ink font-medium">予約</span>
            <span className="mx-1.5">/</span>
            <span>イベント予約</span>
          </nav>
        </div>
        <p className="text-ink-faint text-sm">
          開催するイベントの申込を管理します。定員と承認制の設定ができます。
        </p>
      </div>

      <div data-design="KPIs" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <EventKpi
          title="これからの回"
          value={dataReady ? kpi.upcoming_slots : null}
          unit="回"
          detail={loadDetail(
            Boolean(selectedAccountId),
            loadStatus,
            kpi.nearest_upcoming_starts_at ? `いちばん近いのは ${formatShortJpDate(kpi.nearest_upcoming_starts_at)}` : '予定されている回はありません',
          )}
          help={{ label: 'これからの回の数え方の説明', text: '絞り込みに合うイベントの、今後の開催枠だけを数えています。終わった回は含みません。' }}
        />
        <EventKpi
          title="申込"
          value={dataReady ? kpi.upcoming_active : null}
          unit="人"
          detail={loadDetail(
            Boolean(selectedAccountId),
            loadStatus,
            kpi.fill_rate === null
              ? '定員を確認できません'
              : `定員${kpi.upcoming_capacity}人に対して ${kpi.fill_rate}%`,
          )}
          help={{ label: '申込の数え方の説明', text: '今後の開催枠への申込人数です。終わった回の申込は含みません。' }}
        />
        <EventKpi
          title="あと少しで満席"
          value={dataReady ? kpi.nearly_full : null}
          unit="回"
          detail={loadDetail(
            Boolean(selectedAccountId),
            loadStatus,
            kpi.nearly_full > 0 ? '声をかけると埋まります' : '該当する回はありません',
          )}
          help={{ label: 'あと少しで満席の説明', text: '今後の開催枠のうち、残りが1〜3席の回を数えています。' }}
        />
        <EventKpi
          title="申し込みが少ない"
          value={dataReady ? kpi.low_applications : null}
          unit="回"
          detail={loadDetail(
            Boolean(selectedAccountId),
            loadStatus,
            kpi.nearest_low_starts_at
              ? `${formatShortJpDate(kpi.nearest_low_starts_at)}の回。あと${daysUntilIso(kpi.nearest_low_starts_at) ?? '—'}日です`
              : '該当する回はありません',
          )}
          help={{ label: '申し込みが少ないの説明', text: '7日以内に始まる回のうち、定員の半分に満たない回を数えています。' }}
        />
      </div>

      <Notice tone="info" message="定員に達すると、お客様の画面では自動で「満席」になります。キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。" className="mb-4" />

      {/*
        作る操作は一覧のすぐ上の左。見出しの行の右端には置かない。
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" href="/events/new">＋ イベントを作る</Button>
      </div>

      {/*
        ★V7 `Xn1Mz`：検索は幅320で1行目、2行目は左に絞り込み・
        右端に並び順。押せない選び口は描かない（§5-5）。
        設計の Bar（検索行）・Saved（絞り込み行）は共通 ListToolbar の
        1・2行目にいる。印だけここに残し、設計との突き合わせを保つ。
      */}
      <div data-design="Bar">
      <div data-design="Saved">
      <ListToolbar
        search={{
          placeholder: 'イベント名で検索',
          value: query,
          onChange: (value) => setQuery(clampSearchQuery(value)),
          maxLength: SEARCH_QUERY_MAX_LENGTH,
        }}
        filters={
          <>
            <span className="text-ink-faint text-xs">よく使う</span>
            {(
              [
                ['open', '公開中のみ'],
                ['pending', '承認待ちあり'],
                ['full', '満席'],
              ] as const
            ).map(([key, label]) => (
              <FilterChip
                key={key}
                selected={filter === key}
                onChange={(selected) => setFilter(selected ? key : 'all')}
              >
                {label}
              </FilterChip>
            ))}
          </>
        }
        trailing={
          <label className="text-ink-faint flex items-center gap-2 text-xs whitespace-nowrap">
            並び順
            <Select
              value={sort}
              onChange={(value) => setSort(value as 'soon' | 'name')}
              aria-label="イベントの並び順"
              options={[
                { value: 'soon', label: '日付が近い順' },
                { value: 'name', label: 'イベント名順' },
              ]}
            />
          </label>
        }
      />
      </div>
      </div>

      {!selectedAccountId ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState kind="empty" title="LINEアカウントを選択してください" description="サイドバーで運用するLINEアカウントを選んでください。" />
        </div>
      ) : loadStatus === 'loading' ? (
        <ListState kind="loading" />
      ) : loadStatus === 'error' ? (
        <ListState kind="error" description="登録したイベントは消えていません。再読み込みしても直らない場合はエラー報告へ。" action={<Button onClick={() => void refresh()}>イベントを再読み込み</Button>} />
      ) : items.length === 0 && !query.trim() && filter === 'all' ? (
        <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
          <p className="text-ink mb-2 font-medium">イベントがまだありません</p>
          <p className="text-ink-faint mb-4 text-sm">
            友だちに告知する勉強会・説明会・オフ会などをここから作成します。
          </p>
          <Link
            href="/events/new"
            className="bg-accent-deep text-on-accent rounded-control inline-block px-4 py-2 text-sm font-medium"
          >
            最初のイベントを作成
          </Link>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          条件に合うイベントはありません
        </div>
      ) : (
        <DataTable data-design="Table">
              <thead>
                <TableHeadRow>
                  {/*
                    列幅の合計は 68%。操作列が固定 256px のため、割合を上げると
                    狭い器（1152px で本文約816px）で表が器より広くなり、
                    幅の無い列がつぶれて見出しが重なる。申込条件は状態の下へ畳み、
                    幅の無い列を作らない。
                  */}
                  <Th style={{ width: '18%' }}>イベント名</Th>
                  <Th style={{ width: '16%' }}>開催日時</Th>
                  <Th style={{ width: '12%' }} align="right">予約 / 定員</Th>
                  <Th style={{ width: '10%' }} align="right">承認待ち</Th>
                  <Th style={{ width: '12%' }}>
                    <span className="inline-flex items-center gap-1">
                      状態
                      <HelpTip label="状態の見方の説明">
                        下書き・公開中・一時停止・終了・中止は保存した状態です。満席と申し込みが少ないは、その都度数えた目印で、状態ではありません。
                      </HelpTip>
                    </span>
                  </Th>
                  {/* 操作列は固定幅（256px）。割合にすると中身（2ボタン約242px）が器からはみ出す。 */}
                  <Th align="right" className="w-64">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {items.map((e) => (
                  <Tr key={e.id} interactive>
                    <Td>
                      <Link
                        href={`/events/edit?id=${e.id}`}
                        className="text-ink font-medium hover:underline"
                      >
                        {e.name}
                      </Link>
                      {e.venue_name && (
                        <span className="text-ink-faint block text-xs">{e.venue_name}</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatJpDate(e.next_slot_starts_at)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {e.total_active}
                      <span className="text-ink-faint"> /{' '}
                        {e.total_capacity ?? '—'}
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {e.pending_count > 0 ? (
                        <Link
                          href={`/events/bookings?id=${e.id}`}
                          className="text-warning font-medium hover:underline"
                        >
                          {e.pending_count} 件
                        </Link>
                      ) : (
                        <span className="text-ink-faint">0 件</span>
                      )}
                    </Td>
                    <Td>
                      {/*
                        U: 保存する状態（下書き・公開中・一時停止・終了・中止）
                        を出す。「満席」「申し込みが少ない」は保存せず、その
                        都度数えた目印として横に足す。
                        R81: 公開中でも今後の枠が無ければ「終了」。公開中と
                        出すと、終わった会を募集中として選んでしまう。
                      */}
                      {(() => {
                        const state = eventRowState(e)
                        const primary = (() => {
                          if (state === 'draft') {
                            return (
                              <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs">
                                下書き
                              </span>
                            )
                          }
                          if (state === 'paused') {
                            return (
                              <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs">
                                一時停止
                              </span>
                            )
                          }
                          if (state === 'cancelled') {
                            return (
                              <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs">
                                中止
                              </span>
                            )
                          }
                          if (state === 'ended') {
                            return (
                              <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs">
                                終了
                              </span>
                            )
                          }
                          return (
                            <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs">
                              公開中
                            </span>
                          )
                        })()
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            {primary}
                            {state === 'full' && (
                              <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs">
                                満席
                              </span>
                            )}
                            {state === 'open' && isLowApplication(e) && (
                              <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs">
                                申し込みが少ない
                              </span>
                            )}
                          </div>
                        )
                      })()}
                      {/*
                        申込条件は状態の札の下へ畳む。独立した列にすると狭い器で
                        幅が足りず、見出しが重なり「全員」が縦に折れる。
                        visible_tag_id があると、そのタグの人にしか LIFF の
                        一覧に出ない。タグを消しても ID は残るので、名前が
                        引けないときは別の文言で「もう誰にも見えない」と分かるようにする。
                        タグ名は長いので1行で省略し、全文は title で確認する。
                      */}
                      {!e.visible_tag_id ? (
                        <span className="text-ink-faint mt-1 block max-w-32 truncate text-xs">全員</span>
                      ) : e.visible_tag_name ? (
                        <span className="text-ink-faint mt-1 block max-w-32 truncate text-xs" title={e.visible_tag_name}>
                          {e.visible_tag_name}
                        </span>
                      ) : (
                        <span className="text-warning mt-1 block max-w-32 truncate text-xs">消えたタグ</span>
                      )}
                    </Td>
                    <ActionCell>
                      {/*
                        R217/LAY-18: 「中身を見る」「申込者を見る」のあとに「⋯」を置き、
                        元に戻せない「削除」はメニューの最後へ。削除は owner/admin のみ。
                      */}
                      <RowActions
                        subjectName={e.name}
                        detail={{ href: '/events/edit?id=' + e.id, label: '中身を見る' }}
                        edit={{ href: '/events/bookings?id=' + e.id, label: '申込者を見る' }}
                        destructiveItem={
                          canDelete
                            ? {
                                id: 'delete-event',
                                label: 'イベントを削除',
                                onSelect: () => {
                                  setDeleteError('')
                                  setDeleteTarget(e)
                                },
                              }
                            : undefined
                        }
                      />
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
        </DataTable>
      )}

      <div data-design="tf" className="flex flex-wrap items-center justify-between gap-2">
        {/*
          **「全 0 件」と言い切らない。** 取れていないときの 0件は
          「イベントが無い」に読める。`—` と読み込み中を分ける。
        */}
        <span className="text-ink-faint text-xs">
          {!selectedAccountId || loadStatus === 'error'
            ? '—'
            : loadStatus === 'loading'
              ? '読み込み中'
              : listTotal === 0
                ? '0件'
                : `${(current - 1) * PAGE_SIZE + 1}〜${Math.min(current * PAGE_SIZE, listTotal)}件 / 全${listTotal}件`}
        </span>
        {/*
          **送る先が無いページ送りを出さない。** 取れていないときに
          「1 / 1」と出ると、1ページぶんは取れたように見える。
          共通の `Pagination` に寄せる。
        */}
        {dataReady ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} /> : null}
      </div>

      {/*
        R217: イベント本体の削除確認。申込・順番待ちが残る場合は
        サーバが 409 で止めるので、その理由をこの窓で見せる。
      */}
      <ConfirmDialog
        open={deleteTarget !== null}
        destructive
        title={`「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="このイベントは一覧から外れ、公開中の予約URLは受け付けを止めます。いまある枠も使えなくなります。これまでの申込の記録は残ります。この操作は元に戻せません。"
        confirmLabel="削除する"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDeleteEvent()}
        onCancel={() => {
          if (deleteBusy) return
          setDeleteError('')
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
