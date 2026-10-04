'use client'

/*
 * ★V8 友だち追加時の配信の実行の詳細（板 `N43uVX`）。
 *
 * v7 の実行詳細（runs/detail/page.tsx）とは別の部品として持つ。
 * 読み・再試行・戻り先の引き継ぎは同じ（R268・M010・M011 を変えない）。
 * 違いは置き場と見せ方——失敗の帯・行ったことの段・右の「この追加について」。
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, MessageCircle, Settings2, XCircle } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { api, type FriendAddRunDetail } from '@/lib/api'
import { describeFriendAddFailure } from '../../friend-add-failure'
import { MESSAGE_TYPE_LABEL } from '../../friend-add-flow'
import {
  DELIVERY_UNKNOWN_CODE,
  formatJstDateTime,
  routingAction,
  routingLabel,
} from '../run-status'
import styles from './detail-v8.module.css'

const ACTION_LABELS: Record<string, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報の更新',
  support_mark: '対応マークの更新',
  scenario: 'シナリオ操作',
  common_var: '共通情報の更新',
  mile: 'マイル付与',
  unknown: '処理内容は未取得',
}

function safeErrorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === 'action_failed') return '処理を完了できませんでした。設定と対象データを確認してください。'
  return '処理を完了できませんでした。詳細は運用ログで確認してください。'
}

/** `9/7 10:14:01` の短い形。日付なし（BOMなし）の古い行はそのままJSTで読む。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (bare) return `${Number(bare[2])}/${Number(bare[3])} ${bare[4]}:${bare[5]}:${bare[6] ?? '00'}`
  return formatJstDateTime(value)
}

function shortTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (bare) return `${bare[1]}:${bare[2]}:${bare[3] ?? '00'}`
  return formatJstDateTime(value)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** `9月7日（月）10:14`。曜日はJSTの日付で決める。 */
function titleDate(value: string): string {
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!bare) return formatJstDateTime(value)
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))).getUTCDay()]
  return `${Number(bare[1])}年${Number(bare[2])}月${Number(bare[3])}日（${weekday}）${bare[4]}:${bare[5]}`
}

export default function FriendAddRunDetailV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunDetailV8Inner />
    </Suspense>
  )
}

function FriendAddRunDetailV8Inner() {
  usePageTitle('友だち追加時配信・実行詳細')
  const searchParams = useSearchParams()
  const runId = searchParams.get('id') ?? ''
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
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [missing, setMissing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState('')
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
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
      const failure = describeFriendAddFailure(caught, '失敗した処理', 'retry')
      if (failure.status === 409) await load()
      setNotice(failure.message)
    } finally {
      setRetrying(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="実行詳細を読み込んでいます" />
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
    if (errorStatus === 403) {
      return (
        <NoPermissionV8
          featureName="実行詳細"
          capabilitiesHref="/staff"
          backLabel="実行履歴の一覧へ戻る"
          backHref={listHref}
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

  const actionRuns = detail.actionRuns ?? []
  const failed = actionRuns.filter((action) => action.status === 'failed')
  const failedIndex = failed.length > 0 ? actionRuns.findIndex((action) => action.status === 'failed') : -1
  const displayName = detail.friend.displayName || '名前は未取得'
  const runStatus = routingLabel(detail.status, detail.errorCode)
  const runAction = routingAction(detail.status, detail.errorCode)
  const routeName = detail.attribution.status === 'captured'
    ? detail.attribution.routeName || detail.attribution.reason || '選択した経路'
    : '経路が分からなかった人'
  const ruleName = detail.rule?.name ?? '名前は未取得'
  const ruleVersion = detail.rule?.versionNumber ?? '—'
  const messageType = detail.rule?.definition?.messageType
  const messageLabel = messageType ? MESSAGE_TYPE_LABEL[messageType] ?? '案内' : '案内'
  const friendKindLabel = detail.friendKind === 'first_time' ? 'はじめて' : '再追加・ブロック解除'
  const talkHref = !detail.friend.redacted ? `/chats?friend=${encodeURIComponent(detail.friend.id)}` : null
  const editHref = detail.rule ? `/friend-add-settings?view=edit&id=${encodeURIComponent(detail.rule.id)}` : null

  return (
    <div className={styles.board} data-design-node="N43uVX">
      <div className={styles.head}>
        <Link className={styles.backLink} href={listHref}>← 実行結果へ</Link>
        <h2 className={styles.headTitle}>{displayName}さんの友だち追加</h2>
        <p className={styles.headDescription}>{titleDate(detail.receivedAt)}に追加・{friendKindLabel}</p>
      </div>

      <div className={styles.split}>
        <div className={styles.main}>
          {failed.length > 0 ? (
            <div className={styles.failureBand} role="alert">
              <span className={styles.failureText}>
                <AlertCircle size={15} aria-hidden="true" />
                <span>
                  <strong>{failedIndex + 2}つ目の処理を完了できませんでした</strong>
                  <small>案内は届いています。{ACTION_LABELS[actionRuns[failedIndex]?.type ?? 'unknown'] ?? '処理'}で止まりました。</small>
                </span>
              </span>
              <Button variant="primary" disabled={retrying} busy={retrying} busyLabel="再試行中…" onClick={() => void retry()}>
                失敗した処理をもう一度
              </Button>
            </div>
          ) : null}
          {detail.errorCode === DELIVERY_UNKNOWN_CODE ? (
            <p className={styles.unknownBand} role="alert">{runAction}</p>
          ) : null}

          <section className={styles.card} aria-label="行ったこと">
            <h3 className={styles.cardTitle}>行ったこと</h3>
            <p className={styles.cardDesc}>設定された処理を、省かずに行った順に出します</p>
            <ol className={styles.steps}>
              <li className={styles.stepOk}>
                <span className={styles.stepMark} aria-hidden="true">
                  <Check size={13} />
                </span>
                <span className={styles.stepIndex}>1</span>
                <span className={styles.stepText}>
                  <strong>案内（{messageLabel}）を送った</strong>
                  <small>{shortTime(detail.processedAt ?? detail.receivedAt)}・LINE受信済み</small>
                </span>
              </li>
              {actionRuns.map((action, index) => {
                const ok = action.status === 'completed'
                return (
                  <li key={action.id} className={ok ? styles.stepOk : action.status === 'failed' ? styles.stepNg : styles.stepWait}>
                    <span className={styles.stepMark} aria-hidden="true">
                      {ok ? <Check size={13} /> : action.status === 'failed' ? <XCircle size={14} /> : <span className={styles.stepDot} />}
                    </span>
                    <span className={styles.stepIndex}>{index + 2}</span>
                    <span className={styles.stepText}>
                      <strong>{ACTION_LABELS[action.type] ?? '処理'}</strong>
                      <small>試行 {action.attemptCount}回・{shortTime(action.completedAt ?? action.startedAt)}</small>
                      {safeErrorMessage(action.errorCode) ? <small className={styles.stepError}>{safeErrorMessage(action.errorCode)}</small> : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {failed.length === 0 && detail.status === 'failed' ? (
            <Button variant="primary" disabled={retrying} busy={retrying} busyLabel="再試行中…" onClick={() => void retry()}>
              失敗した処理をもう一度
            </Button>
          ) : null}
        </div>

        <aside className={styles.side} aria-label="この追加について">
          <section className={styles.card} aria-label="この追加について">
            <h3 className={styles.cardTitle}>この追加について</h3>
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>友だち</dt>
                <dd>{displayName}</dd>
              </div>
              <div className={styles.row}>
                <dt>追加の種類</dt>
                <dd>{friendKindLabel}</dd>
              </div>
              <div className={styles.row}>
                <dt>来た経路</dt>
                <dd>{routeName}</dd>
              </div>
              <div className={styles.row}>
                <dt>動いた設定</dt>
                <dd>{ruleName}（第{ruleVersion}版）</dd>
              </div>
              <div className={styles.row}>
                <dt>受けた日時</dt>
                <dd>{shortDateTime(detail.receivedAt)}</dd>
              </div>
              <div className={styles.row}>
                <dt>処理した日時</dt>
                <dd>{shortDateTime(detail.processedAt)}</dd>
              </div>
              <div className={styles.row}>
                <dt>記録ID（お問い合わせ用）</dt>
                <dd className={styles.mono} title={detail.id}>{detail.id}</dd>
              </div>
            </dl>
          </section>
          <div className={styles.sideActions}>
            {talkHref ? (
              <Button href={talkHref} variant="secondary">
                <MessageCircle size={14} aria-hidden="true" />
                トークを開く
              </Button>
            ) : null}
            {editHref ? (
              <Button href={editHref} variant="secondary">
                <Settings2 size={14} aria-hidden="true" />
                設定を開く
              </Button>
            ) : null}
          </div>
          <p className={styles.statusNote}>{runStatus.label}・{runAction}</p>
        </aside>
      </div>
    </div>
  )
}
