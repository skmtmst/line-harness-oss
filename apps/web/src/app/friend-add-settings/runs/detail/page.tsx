'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { api, ApiError, type FriendAddRunDetail } from '@/lib/api'

const ACTION_LABELS: Record<string, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報の更新',
  support_mark: '対応マークの更新',
  scenario: 'シナリオ操作',
  common_var: '共通情報の更新',
  mile: 'マイル付与',
  unknown: '処理内容は未取得',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '開始待ち',
  running: '実行中',
  completed: '成功',
  failed: '失敗',
}

function safeErrorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === 'action_failed') return '処理を完了できませんでした。設定と対象データを確認してください。'
  return '処理を完了できませんでした。詳細は運用ログで確認してください。'
}

function FriendAddRunDetailInner() {
  usePageTitle('友だち追加時配信・実行詳細')
  const searchParams = useSearchParams()
  const runId = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<FriendAddRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState('')
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    // アカウント切替直後は、前アカウントの詳細を一瞬でも残さない。
    setDetail(null)
    setNotice('')
    if (!selectedAccountId || !runId) {
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setMissing(false)
    try {
      const response = await api.friendAddRules.runDetail(selectedAccountId, runId)
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setError('実行詳細を表示できませんでした。')
        return
      }
      setDetail(response.data)
    } catch (caught) {
      if (requestId !== requestSequence.current) return
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
        return
      }
      setError('実行詳細を表示できませんでした。')
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [runId, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
    return () => { requestSequence.current += 1 }
  }, [accountLoading, load])

  const retry = async () => {
    if (!selectedAccountId || !detail || retrying) return
    setRetrying(true)
    setNotice('')
    try {
      const response = await api.friendAddRules.retryRun(selectedAccountId, detail.id)
      if (!response.success) {
        setNotice('失敗した処理を再試行できませんでした。状態を読み直してください。')
        return
      }
      setNotice(`${response.data.retried}件の失敗処理を再試行しました。`)
      await load()
    } catch {
      setNotice('失敗した処理を再試行できませんでした。状態を読み直してください。')
    } finally {
      setRetrying(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="実行詳細を読み込んでいます" />
  /*
    U098: 対象未指定・アカウント未選択・読み込み失敗を分ける。
    「もう一度読み込む」だけだと、対象が無いまま同じ失敗を繰り返す。
  */
  if (!runId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見る実行詳細が指定されていません"
        description="実行履歴の一覧から、見る記録を選び直してください。"
        backHref="/friend-add-settings/runs"
        backLabel="実行履歴の一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINEアカウントを選んでください" description="上部でLINEアカウントを選ぶと、その実行詳細を表示できます。" />
  }
  if (missing || (!error && !detail)) {
    return (
      <TargetMissing
        kind="not-found"
        title="この実行詳細は見つかりません"
        description="対象の記録が見つかりません。削除されたか、一覧から選び直してください。"
        backHref="/friend-add-settings/runs"
        backLabel="実行履歴の一覧へ戻る"
      />
    )
  }
  if (error || !detail) {
    return (
      <TargetMissing
        kind="error"
        title="実行詳細を表示できませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  /*
   * 形の違う応答は空として扱う。そのまま回すと `actionRuns.filter` で
   * 画面ごと落ちる（全ルート監査 A1、2026-09-25）。
   */
  const actionRuns = detail.actionRuns ?? []
  const failed = actionRuns.filter((action) => action.status === 'failed')
  const displayName = detail.friend.displayName || '名前は未取得'
  const runStatus = detail.status === 'completed'
    ? { label: '完了', tone: 'success' as const }
    : detail.status === 'suppressed'
      ? { label: '配信なし', tone: 'info' as const }
      : detail.status === 'pending'
        ? { label: '処理中', tone: 'info' as const }
        : { label: '一部失敗', tone: 'danger' as const }

  return (
    <div className="space-y-4 pb-8">
      <Link className="text-sm font-bold text-action hover:underline" href="/friend-add-settings/runs">← 実行結果へ戻る</Link>
      <section className="rounded-card border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-bold">{displayName}</p>
            <p className="mt-1 text-sm text-ink-secondary">{detail.rule?.name ?? '使用ルールは未取得'}</p>
          </div>
          <StatusBadge tone={runStatus.tone}>{runStatus.label}</StatusBadge>
        </div>
      </section>

      <section className="rounded-card border border-hairline bg-canvas p-4">
        <h2 className="font-bold">あわせて実行した処理</h2>
        <p className="mt-1 text-xs text-ink-faint">設定された処理を省略せず、実行順に表示します。</p>
        {actionRuns.length === 0 ? (
          <p className="mt-4 text-sm text-ink-secondary">実行した処理はありません。</p>
        ) : (
          <div className="mt-3 divide-y divide-hairline">
            {actionRuns.map((action, index) => {
              const message = safeErrorMessage(action.errorCode)
              return (
                <div key={action.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <strong className="block truncate">{index + 1}. {ACTION_LABELS[action.type] ?? '処理'}</strong>
                    <p className="mt-1 text-xs text-ink-faint">試行 {action.attemptCount}回</p>
                    {message && <p className="mt-1 text-xs text-status-danger-deep">{message}</p>}
                  </div>
                  <StatusBadge tone={action.status === 'failed' ? 'danger' : action.status === 'completed' ? 'success' : 'info'}>
                    {STATUS_LABELS[action.status] ?? '確認中'}
                  </StatusBadge>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {notice && <p role="status" className="text-sm font-bold">{notice}</p>}
      {failed.length > 0 && (
        <Button variant="primary" disabled={retrying} onClick={() => void retry()}>
          {retrying ? '再試行中…' : `失敗した${failed.length}件だけ再試行`}
        </Button>
      )}
    </div>
  )
}

export default function FriendAddRunDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunDetailInner />
    </Suspense>
  )
}
