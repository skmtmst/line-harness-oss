'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { api, type FriendAddRunDetail } from '@/lib/api'

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

export default function FriendAddRunDetailPage() {
  usePageTitle('友だち追加時配信・実行詳細')
  const params = useParams<{ id: string }>()
  const runId = typeof params.id === 'string' ? params.id : ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<FriendAddRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    try {
      const response = await api.friendAddRules.runDetail(selectedAccountId, runId)
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setError('実行詳細を表示できませんでした。')
        return
      }
      setDetail(response.data)
    } catch {
      if (requestId === requestSequence.current) setError('実行詳細を表示できませんでした。')
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
  if (error || !detail) {
    return <ListState kind="error" title="実行詳細を表示できませんでした" description={error || '対象の記録が見つかりません。'} action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
  }

  const failed = detail.actionRuns.filter((action) => action.status === 'failed')
  const displayName = detail.friend.displayName || '名前は未取得'

  return (
    <div className="space-y-4 pb-8">
      <Link className="text-sm font-bold text-accent hover:underline" href="/friend-add-settings/runs">← 実行結果へ戻る</Link>
      <section className="rounded-card border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">実行詳細</h1>
            <p className="mt-1 text-sm text-ink-secondary">{displayName}・{detail.rule?.name ?? '使用ルールは未取得'}</p>
          </div>
          <StatusBadge tone={failed.length > 0 ? 'danger' : 'success'}>{failed.length > 0 ? '一部失敗' : '完了'}</StatusBadge>
        </div>
      </section>

      <section className="rounded-card border border-hairline bg-canvas p-4">
        <h2 className="font-bold">あわせて実行した処理</h2>
        <p className="mt-1 text-xs text-ink-faint">設定された処理を省略せず、実行順に表示します。</p>
        {detail.actionRuns.length === 0 ? (
          <p className="mt-4 text-sm text-ink-secondary">実行した処理はありません。</p>
        ) : (
          <div className="mt-3 divide-y divide-hairline">
            {detail.actionRuns.map((action, index) => {
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
