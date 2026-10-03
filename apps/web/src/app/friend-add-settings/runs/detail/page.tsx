'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { api, type FriendAddRunDetail } from '@/lib/api'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { describeFriendAddFailure } from '../../friend-add-failure'
import FriendAddRunDetailV8 from './detail-v8'
import {
  DELIVERY_UNKNOWN_ACTION,
  DELIVERY_UNKNOWN_CODE,
  formatJstDateTime,
  routingAction,
  routingLabel,
} from '../run-status'

const ACTION_LABELS: Record<string, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報の更新',
  support_mark: '対応マークの更新',
  scenario: 'シナリオ操作',
  common_var: '共通情報の更新',
  mile: 'マイル付与',
  unknown: '処理内容は未取得',
}

/** 付随処理の状態。イベント自体の配信・処理状態（run-status）とは別の言葉。 */
const ACTION_STATUS_LABELS: Record<string, string> = {
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
  /*
   * 一覧から受け取った絞り込み・ページ位置を戻り先へ引き継ぐ。
   * 条件なしの一覧URLにすると、絞り込みが外れて同じ記録を探し直す
   * ことになる（R268）。
   */
  const listHref = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of ['kind', 'status', 'attribution', 'rule_id', 'pages']) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    const query = params.toString()
    return `/friend-add-settings/runs${query ? `?${query}` : ''}`
  }, [searchParams])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<FriendAddRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // M010: 403 は共通部品の forbidden で出す。HTTP の状態をそのまま渡す。
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
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
    setErrorStatus(null)
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
      // M010: 403 は権限不足と分かる文にし、「通信が切れた」とは言わない。
      const failure = describeFriendAddFailure(caught, '実行詳細', 'load')
      if (failure.status === 404) {
        setMissing(true)
        return
      }
      setError(failure.message)
      setErrorStatus(failure.status)
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
    } catch (caught) {
      // M011: 権限・対象なし・再試行中を一律にしない。409 は応答消失後の
      // 再送（実際は通っている）ことがあるので、先に読み直して今を見てから
      // 文を出す（読み直しがお知らせを消すため）。
      const failure = describeFriendAddFailure(caught, '失敗した処理', 'retry')
      if (failure.status === 409) await load()
      setNotice(failure.message)
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
        backHref={listHref}
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
        backHref={listHref}
        backLabel="実行履歴の一覧へ戻る"
      />
    )
  }
  if (error || !detail) {
    // M010: 403 は権限の面で出す。通信断と混ぜない。
    if (errorStatus === 403) {
      return (
        <ListState
          kind="forbidden"
          title="実行詳細を表示する権限がありません"
          description={error}
          onRetry={() => void load()}
        />
      )
    }
    return (
      <TargetMissing
        kind="error"
        title="実行詳細を表示できませんでした"
        description={error || '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'}
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
  // 一覧と同じ判定を使う。詳細だけ「送達不明」を「配信なし」と表示すると、
  // 届いたか分からない記録を「送っていない」と読み違える（R267）。
  const runStatus = routingLabel(detail.status, detail.errorCode)
  const runAction = routingAction(detail.status, detail.errorCode)
  const routeName = detail.attribution.status === 'captured'
    ? detail.attribution.routeName || detail.attribution.reason || '選択した経路'
    : '経路は記録されていません'
  const ruleLabel = detail.rule
    ? `${detail.rule.name ?? '名前は未取得'}・第${detail.rule.versionNumber ?? '—'}版`
    : '使用ルールは未取得'

  return (
    <div className="space-y-4 pb-8">
      <Link className="text-sm font-bold text-action hover:underline" href={listHref}>← 実行結果へ戻る</Link>
      <section className="rounded-card border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold">{displayName}</p>
            <p className="mt-1 text-sm text-ink-secondary">{runAction}</p>
          </div>
          <StatusBadge tone={runStatus.tone}>{runStatus.label}</StatusBadge>
        </div>
        {detail.errorCode === DELIVERY_UNKNOWN_CODE ? (
          <Notice tone="danger" className="mt-3">{DELIVERY_UNKNOWN_ACTION}</Notice>
        ) : null}
        {/*
          R265: 同じ友だちの別の記録を詳細だけで見分けられるよう、
          日時・追加の種類・経路・適用ルールと版・記録IDを先頭に置く。
        */}
        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-hairline pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-faint">受信日時</dt>
            <dd className="mt-0.5">{formatJstDateTime(detail.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">処理日時</dt>
            <dd className="mt-0.5">{detail.processedAt ? formatJstDateTime(detail.processedAt) : 'まだ処理していません'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">追加の種類</dt>
            <dd className="mt-0.5">{detail.friendKind === 'first_time' ? 'はじめて' : '再追加・ブロック解除'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">流入経路</dt>
            <dd className="mt-0.5">{routeName}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">適用ルール</dt>
            <dd className="mt-0.5">{ruleLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">記録ID（お問い合わせ用）</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{detail.id}</dd>
          </div>
        </dl>
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
                    <p className="mt-1 text-xs text-ink-faint">
                      試行 {action.attemptCount}回・{formatJstDateTime(action.completedAt ?? action.startedAt)}
                    </p>
                    {message && <p className="mt-1 text-xs text-danger">{message}</p>}
                  </div>
                  <StatusBadge tone={action.status === 'failed' ? 'danger' : action.status === 'completed' ? 'success' : 'info'}>
                    {ACTION_STATUS_LABELS[action.status] ?? '確認中'}
                  </StatusBadge>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {notice && <p role="status" className="text-sm font-bold">{notice}</p>}
      {failed.length > 0 && (
        <Button variant="primary" disabled={retrying} onClick={() => void retry()} busy={retrying} busyLabel="再試行中…">
          {`失敗した${failed.length}件だけ再試行`}
        </Button>
      )}
    </div>
  )
}

export default function FriendAddRunDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunDetailSwitch />
    </Suspense>
  )
}

function FriendAddRunDetailSwitch() {
  /*
   * ★V8 分岐：実行の詳細（板 `N43uVX`）を `data-theme="v8"` の下で積み替える。
   */
  const theme = useAdminTheme()
  return theme === 'v8' ? <FriendAddRunDetailV8 /> : <FriendAddRunDetailInner />
}
