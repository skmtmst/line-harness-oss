'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, fetchApi } from '@/lib/api'
import { inboxItemHref, type PendingInboxSummary } from '@/components/support/pending-inbox-card'
import Pagination from '@/components/shared/pagination'
import SectionHeader from './head'
import StatusBadge from '@/components/shared/status-badge'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { formatTime } from '@/lib/format'
import styles from './dashboard.module.css'

/*
 * 対応が必要な受信（全アカウント）（WQmep 段B）。
 * 取り方は v7 の PendingInboxCard と同じ（`/api/support/inbox?status=open`・
 * 30秒ごと・画面に戻ったとき・担当者ごとの表示件数）。上の数の帯の
 * メール件数・最長待ちの出どころでもあるので、件数を親へ知らせる。
 */
type InboxItem = {
  id: string
  channel: 'line' | 'email'
  customerName: string
  preview: string
  lastIncomingAt: string
}

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20]
const DEFAULT_PAGE_SIZE = 5
const PAGE_SIZE_STORAGE_PREFIX = 'lh_pending_inbox_page_size:'

function elapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`
}

export function InboxSection({ onSummaryChange }: {
  onSummaryChange: (summary: PendingInboxSummary | null, ok?: boolean) => void
}) {
  const [summary, setSummary] = useState<PendingInboxSummary | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])
  const [loadFailure, setLoadFailure] = useState<null | 'error' | 'forbidden'>(null)
  const [loading, setLoading] = useState(true)
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const loadSeq = useRef(0)
  const total = summary?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        try {
          const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_PREFIX + response.data.id)
          const restored = raw === null ? NaN : Number(raw)
          if (PAGE_SIZE_OPTIONS.includes(restored)) {
            setPageSize(restored)
            setPage(1)
          }
        } catch { /* storage unavailable */ }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const response = await fetchApi<{ success: boolean; data: { items: InboxItem[]; summary: PendingInboxSummary } }>(
        `/api/support/inbox?status=open&limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      )
      if (seq !== loadSeq.current) return
      if (response.success) {
        setSummary(response.data.summary)
        onSummaryChange(response.data.summary, true)
        setItems(response.data.items)
        setLoadFailure(null)
        setLastSuccessAt(new Date())
      } else {
        setLoadFailure('error')
        onSummaryChange(null, false)
      }
    } catch (caught) {
      if (seq !== loadSeq.current) return
      setLoadFailure(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
      onSummaryChange(null, false)
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
    <>
      <SectionHeader title="対応が必要な受信（全アカウント）" href="/chats" linkLabel="受信箱をすべて見る" />
      {loadFailure && summary ? (
        <p role="status" className={styles.stale}>
          {`最新の状態に更新できませんでした。${lastSuccessAt ? `最終更新 ${formatTime(lastSuccessAt)} の内容を表示しています。` : ''}`}
          <button type="button" className={styles.inlineButton} onClick={() => void load()}>もう一度読み込む</button>
        </p>
      ) : null}
      {loadFailure === 'forbidden' && !summary ? (
        <p className={styles.empty}>{`${STATE_TEXT.forbiddenView}。`}</p>
      ) : loadFailure && !summary ? (
        <p className={styles.empty}>
          {`データを${STATE_TEXT.error}。`}
          <button type="button" className={styles.inlineButton} onClick={() => void load()}>もう一度読み込む</button>
        </p>
      ) : loading && !summary ? (
        <p className={styles.empty}>{`${STATE_TEXT.loading}…`}</p>
      ) : !summary || summary.total === 0 ? (
        <p className={styles.empty}>返信を待っている問い合わせはありません。</p>
      ) : (
        <div className={styles.inboxTable} role="table" aria-label="対応が必要な受信">
          <div className={styles.inboxHead} role="row">
            <span role="columnheader" className={styles.colName}>お名前</span>
            <span role="columnheader" className={styles.colBody}>内容</span>
            <span role="columnheader" className={styles.colWait}>待ち時間</span>
            <span role="columnheader" className={styles.colState}>状態</span>
          </div>
          {items.map((item) => (
            <div key={item.id} className={styles.inboxRow} role="row">
              <span role="cell" className={styles.colName}>
                <span className={styles.route}>{item.channel === 'email' ? 'メール' : 'LINE'}</span>
                <Link href={inboxItemHref(item)} className={styles.inboxName} title={`${item.customerName}の受信箱を開く`}>
                  {item.customerName}
                </Link>
              </span>
              <span role="cell" className={styles.colBody} title={item.preview}>{item.preview}</span>
              <span role="cell" className={styles.colWait}>{elapsed(item.lastIncomingAt)}</span>
              <span role="cell" className={styles.colState}><StatusBadge tone="warning" size="compact">未確認</StatusBadge></span>
            </div>
          ))}
          {pageCount > 1 ? (
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="受信一覧のページ送り" className={styles.inboxPager} />
          ) : null}
        </div>
      )}
    </>
  )
}
