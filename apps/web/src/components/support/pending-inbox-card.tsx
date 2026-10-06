'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, fetchApi } from '@/lib/api'
import Card, { CardHeader } from '@/components/shared/card'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import StatusBadge from '@/components/shared/status-badge'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { dashboardLocalUpdatedAt } from '@/components/dashboard/freshness'
import Notice from '@/components/shared/notice'
import { formatTime } from '@/lib/format'

/**
 * 対応が必要な受信（設計 `V2 1-1 ダッシュボード` の `card 対応が必要な受信`）。
 *
 * 以前は画面上部に赤いグラデーションの帯として出していた（SupportAlertPanel）。
 * 設計では左カラムのカードで、名前・メッセージ・返信日時の表になっている。
 * 上部の帯は「ケアが必要な子」に譲る。
 *
 * 帯からカードに変えたのは見た目の都合ではない。赤い帯は「いま何かが
 * 壊れている」という強さで、常時1件2件ある問い合わせに使うと慣れてしまう。
 * 一覧として置けば、件数と中身を同じ重さで読める。
 */

export type PendingInboxSummary = {
  total: number
  line: number
  email: number
  emailUnread: number
  oldestWaitMinutes: number | null
}

type InboxItem = {
  id: string
  channel: 'line' | 'email'
  customerName: string
  preview: string
  lastIncomingAt: string
}

export function inboxItemHref(item: Pick<InboxItem, 'channel' | 'id'>): string {
  const rawId = item.id.replace(/^(line|email):/, '')
  /*
   * `status=unread` は受信箱側が読む絞り込み（IDEA-01）。
   * 旧 `unanswered=1` も受信箱側で「未対応」として受け続ける。
   */
  return item.channel === 'email'
    ? `/chats?channel=email&thread=${encodeURIComponent(rawId)}`
    : `/chats?friend=${encodeURIComponent(rawId)}&status=unread`
}

/**
 * 1ページに出す数。**固定にしない。**
 *
 * 5件に固定していたころ、総数5件でも2行しか出せず、**残りへ行く手段が
 * 無かった**（ページ送りも表示件数も無い）。設計（`vUXKb` / `NjK9q`）は
 * 表の右上に「表示件数」があり、下にページ送りがある。
 */
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20]
const DEFAULT_PAGE_SIZE = 5

/*
 * 表示件数は担当者ごとの表示設定として保存する（DASH-25）。
 * 担当者IDをキーに含めないと、同じ端末・ブラウザを使う別の担当者へ
 * この人の設定が引き継がれてしまう。
 */
const PAGE_SIZE_STORAGE_PREFIX = 'lh_pending_inbox_page_size:'

function elapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`
}

function ChannelBadge({ channel }: { channel: InboxItem['channel'] }) {
  return (
    <span
      className={`mr-2 rounded-pill px-1.5 py-0.5 text-nano font-medium ${
        channel === 'email'
          ? 'bg-canvas-sunken text-ink-secondary'
          : 'bg-accent-soft text-accent-deep'
      }`}
    >
      {channel === 'email' ? 'メール' : 'LINE'}
    </span>
  )
}

export default function PendingInboxCard({
  onSummaryChange,
}: {
  /*
   * 取得の成否も一緒に知らせる（IDEA-01）。失敗時は summary=null・
   * ok=false で呼び、上部の小カードが「0件」と失敗を取り違えないようにする。
   */
  onSummaryChange?: (summary: PendingInboxSummary | null, ok?: boolean) => void
}) {
  const [summary, setSummary] = useState<PendingInboxSummary | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])
  /*
   * **読めなかったのか、0件なのかを分ける。**
   *
   * 前は失敗しても `summary` が `null` のまま残り、下の表示条件で
   * 「返信を待っている問い合わせはありません。」になった。通信障害・
   * 500 のときに未対応があるのか無いのか区別できず、返信漏れになる。
   * 取れていないときは「なし」と言い切らず、読み直しを出す。
   * 403 は「失敗」ではなく「権限が無い」ので文言を分ける（A01-06）。
   */
  const [loadFailure, setLoadFailure] = useState<null | 'error' | 'forbidden'>(null)
  /* 初回の読込が終わるまで「0件」と言い切らない（A01-06）。 */
  const [loading, setLoading] = useState(true)
  /* 最後に成功した時刻。成功後の失敗で古い値を最新と誤認させない（DASH-24）。 */
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  /*
   * 応答順の逆転で古い結果が新しい件数を上書きしないよう、
   * 発行ごとの番号を付ける（DASH-23）。復帰時・30秒更新・ページ切替で
   * 要求が重なっても、最新の要求の応答だけを画面へ反映する。
   */
  const loadSeq = useRef(0)
  const staffIdRef = useRef<string | null>(null)
  const total = summary?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  /*
   * 担当者ごとの表示件数を復元する（DASH-25）。
   * staff.me が取れない環境では保存を諦め、その場の選択だけを使う。
   */
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        staffIdRef.current = response.data.id
        try {
          const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_PREFIX + response.data.id)
          const restored = raw === null ? NaN : Number(raw)
          if (PAGE_SIZE_OPTIONS.includes(restored)) {
            setPageSize(restored)
            setPage(1)
          }
        } catch { /* storage unavailable */ }
      })
      .catch(() => { /* 本人情報が取れなくても一覧は使える */ })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const inboxResponse = await fetchApi<{
        success: boolean
        data: { items: InboxItem[]; summary: PendingInboxSummary }
      }>(`/api/support/inbox?status=open&limit=${pageSize}&offset=${(page - 1) * pageSize}`)
      // 遅れて返った古い応答は捨てる。画面には最新の要求の結果だけを出す。
      if (seq !== loadSeq.current) return
      if (inboxResponse.success) {
        setSummary(inboxResponse.data.summary)
        onSummaryChange?.(inboxResponse.data.summary, true)
        setItems(inboxResponse.data.items)
        setLoadFailure(null)
        setLastSuccessAt(new Date())
      } else {
        // 形違いの返事も「なし」にしない。無いのは数ではなく取れた事実。
        setLoadFailure('error')
        onSummaryChange?.(null, false)
      }
    } catch (caught) {
      if (seq !== loadSeq.current) return
      // ダッシュボード本体は残し、次のポーリングで復旧する。
      // ただし取れていないことを黙らせない（下の表示で読み直しを出す）。
      setLoadFailure(
        caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error',
      )
      onSummaryChange?.(null, false)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [onSummaryChange, page, pageSize])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return (
    <Card layout="vertical" overflow="hidden" className="h-fit min-w-0">
      {/*
        行き先リンクは見出しの行の右端に1つ（CardHeader の action）。
        ほかのカード（「さらに詳しく →」「アクセス解析へ →」「すべて見る →」）
        と同じ部品・同じ色・同じ大きさにする。独自の文字色・大きさや
        矢印なしの書き方はしない。
      */}
      <CardHeader
        size="roomy"
        /*
          この一覧は可視の全アカウントの合計。同じ画面の小カード
          「対応が必要な受信」(選択中のアカウントの数)とは範囲が違うため、
          範囲を題に書いて混同を防ぐ。
          件数は小カードの1か所に集約し、見出しの横では繰り返さない（m22d）。
        */
        title="対応が必要な受信（全アカウント）"
        action={<Link href="/chats" className="hover:underline">受信箱をすべて見る →</Link>}
        actionTone="info"
      />

      {/*
        一覧がいつ時点のものか。30秒ごとの再取得で古い値を最新と誤認しない。
        見出し行と別行にする（DASH-26）。320pxでは見出し・件数・リンクを
        1行に収まらない。リンクと同じ行に押し込まない。
        まだ一度も取れていないときは行ごと出さない（空の罫線を残さない）。
      */}
      {dashboardLocalUpdatedAt(lastSuccessAt) ? (
        <div className="border-hairline flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-b px-5 pb-2">
          {/*
            ダッシュボードでは件数を変えさせない（★V7 ダッシュボードの見せ方、2026-09-24）。
            ここは「いま対応が要る人」をひと目で見る場所で、全件は受信箱で見る。
            以前あった「表示件数」のプルダウンは外した（保存済みの件数は読むだけ）。
          */}
          <span className="text-ink-faint text-xs">{dashboardLocalUpdatedAt(lastSuccessAt)}</span>
        </div>
      ) : null}

      {/*
        成功済みの数を残したまま、直近の更新に失敗したことを隠さない
        （DASH-24）。古い値を通常の最新値と誤認させないため、
        最後に取れた時刻と読み直しを一覧の上に出す。
      */}
      {loadFailure && summary ? (
        <Notice
          tone="warn"
          action={<button type="button" onClick={() => void load()} className="font-medium underline">もう一度読み込む</button>}
        >
          最新の状態に更新できませんでした。
          {lastSuccessAt ? `最終更新 ${formatTime(lastSuccessAt)} の内容を表示しています。` : ''}
        </Notice>
      ) : null}

      {loadFailure === 'forbidden' && !summary ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-5 py-6 text-center">
          <p className="text-ink-faint text-sm">{STATE_TEXT.forbiddenView}。</p>
        </div>
      ) : loadFailure && !summary ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-5 py-6 text-center">
          <p className="text-ink-faint text-sm">データを{STATE_TEXT.error}。</p>
          <button type="button" onClick={() => void load()} className="text-action text-xs font-medium hover:underline">もう一度読み込む</button>
        </div>
      ) : loading && !summary ? (
        <p className="text-ink-faint flex min-h-24 items-center justify-center px-5 py-6 text-center text-sm">
          {STATE_TEXT.loading}…
        </p>
      ) : !summary || summary.total === 0 ? (
        <p className="text-ink-faint flex min-h-24 items-center justify-center px-5 py-6 text-center text-sm">
          返信を待っている問い合わせはありません。
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/*
            狭い画面では4列の表が見切れるため、320px台は1件ずつ縦に並べる
            （DASH-26）。表はsm以上に限定し、モバイルは名前・本文・待ち時間・
            状態を各行へ分ける。
          */}
          <div className="min-h-0 flex-1 overflow-hidden max-sm:hidden">
            {/*
              状態の列は札の幅に合わせた固定幅にする。割合（10%）にすると
              狭い幅で札が右の余白へ食い込む。残りは内容の列で吸収する
              （幅を指定しない列が伸びる）。右端の余白は見出しと同じ px-5。
            */}
            <DataTable className="rounded-none border-0">
              <thead>
                <TableHeadRow>
                  <Th style={{ width: '36%' }}>お名前</Th>
                  <Th>内容</Th>
                  <Th style={{ width: '14%' }} align="right" className="whitespace-nowrap">待ち時間</Th>
                  {/* 状態の札（約52px＋余白）に合わせた固定幅。96px では右に空く。 */}
                  <Th style={{ width: 80 }} className="whitespace-nowrap">状態</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {items.map((item) => (
                  // 行の高さ 61px は設計のまま（共通 Tr の既定 58px ではない）。
                  // Tailwind v4 は層（utilities）のため部品CSSに負ける。style で保つ。
                  <Tr key={item.id} interactive className="h-[61px]" style={{ height: 61 }}>
                    <Td className="overflow-hidden whitespace-nowrap">
                      <ChannelBadge channel={item.channel} />
                      <Link
                        href={inboxItemHref(item)}
                        className="text-ink font-medium hover:text-action hover:underline focus-visible:text-action focus-visible:underline"
                        title={`${item.customerName}の受信箱を開く`}
                      >
                        {item.customerName}
                      </Link>
                    </Td>
                    <Td className="text-ink-secondary truncate" title={item.preview}>
                      {item.preview}
                    </Td>
                    <Td align="right" className="text-ink-faint text-xs whitespace-nowrap">
                      {elapsed(item.lastIncomingAt)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <StatusBadge tone="warning" size="compact">未確認</StatusBadge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          <ul className="divide-hairline divide-y sm:hidden">
            {items.map((item) => (
              <li key={item.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <ChannelBadge channel={item.channel} />
                    <Link
                      href={inboxItemHref(item)}
                      className="text-ink font-medium break-all hover:text-action hover:underline focus-visible:text-action focus-visible:underline"
                    >
                      {item.customerName}
                    </Link>
                  </span>
                  <StatusBadge tone="warning" size="compact">未確認</StatusBadge>
                </div>
                <p className="text-ink-secondary mt-1 truncate text-xs" title={item.preview}>
                  {item.preview}
                </p>
                <p className="text-ink-faint mt-1 text-xs">
                  待ち時間 {elapsed(item.lastIncomingAt)}
                </p>
              </li>
            ))}
          </ul>
          {/*
            件数は小カードの1か所に集約し、一覧の下では繰り返さない（m22d）。
            ページ送りだけ残す。1ページに収まるときは Pagination が null を
            返すので、帯ごと出さない（押せない空の帯を残さない）。
          */}
          {total > 0 && pageCount > 1 ? (
            <nav
              className="border-hairline flex h-[50px] shrink-0 items-center justify-end gap-3 border-t px-5"
              aria-label="受信一覧のページ送り"
            >
              <Pagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
                ariaLabel="受信一覧のページ送り"
              />
            </nav>
          ) : null}
        </div>
      )}
    </Card>
  )
}
