'use client'

/*
 * ★V8 友だち追加時の配信の実行の詳細（Pencil `N43uVX`・失敗あり）。
 *
 * 型の頭（戻る・題・説明）→ 線 → 左（失敗の帯・行ったこと）と右の欄（この追加について・トーク・設定）。
 * 白い板が 1100px を切ったら右の欄を左の下へ畳む。
 * 取得・もう一度実行・戻り先の引き継ぎ（R268・M010・M011）は `app/friend-add-settings/runs/detail/detail-v8.tsx`
 * から写した（import はしない）。動きの一覧は BEHAVIOR.md。
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, MessageCircle, RotateCcw, Settings2, XCircle } from 'lucide-react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendAddRunDetail } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { describeFriendAddFailure } from '@/v8/friend-add/failure'
import { MESSAGE_TYPE_LABEL } from '@/v8/friend-add/flow'
import { DELIVERY_UNKNOWN_CODE, jstClock, jstShortDateTime, jstTitleDate, routingAction } from './status'
import styles from './detail.module.css'

type ActionRun = FriendAddRunDetail['actionRuns'][number]

/** 処理の種類の名前（設定の言葉が読めないとき）。 */
const ACTION_LABELS: Record<string, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報の更新',
  support_mark: '対応マークの更新',
  scenario: 'シナリオ操作',
  common_var: '共通情報の更新',
  mile: 'マイル付与',
}

/** 失敗の帯の「〇〇ところで止まりました」。 */
const ACTION_STOPPED_AT: Record<string, string> = {
  tag: 'タグを付けるところ',
  friend_field: '友だち情報を更新するところ',
  support_mark: '対応マークを付けるところ',
  scenario: 'シナリオを始めるところ',
  common_var: '共通情報を更新するところ',
  mile: 'マイルを付けるところ',
}

/** 設定の処理（`add_tag` など）と、実行した処理の種類（`tag` など）が同じ仲間か。 */
const CONFIGURED_KIND: Record<string, string> = { add_tag: 'tag', remove_tag: 'tag', start_scenario: 'scenario' }

function safeErrorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === 'action_failed') return '処理を完了できませんでした。設定と対象データを確認して、もう一度実行してください。'
  return '処理を完了できませんでした。詳細は運用ログで確認してください。'
}

/** 「〜する／〜ける」を終わった形にする（成功した処理だけ）。読めない言い方はそのまま。 */
export function pastTense(label: string): string {
  if (label.endsWith('する')) return `${label.slice(0, -2)}した`
  if (/[けめえせてねべれげ]る$/.test(label)) return `${label.slice(0, -1)}た`
  return label
}

/**
 * 実行した処理の名前。`stableId` の末尾（`<版>:<番号>`）が設定の処理の番号で、種類が同じ仲間のときだけ
 * 設定の言葉（例：タグ「新規」を付ける）を使う。合わないときは種類の名前に倒す（違う処理の名前を出さない）。
 */
export function actionTitle(action: ActionRun, configured: unknown[] | undefined): string {
  const index = Number(action.stableId.split(':').pop())
  const config = Number.isInteger(index) ? configured?.[index] : undefined
  const fallback = ACTION_LABELS[action.type] ?? '処理'
  if (!config || typeof config !== 'object') return fallback
  const { type, label } = config as { type?: unknown; label?: unknown }
  if (typeof label !== 'string' || !label || typeof type !== 'string' || CONFIGURED_KIND[type] !== action.type) return fallback
  return action.status === 'completed' ? pastTense(label) : label
}

/** 記録ID は長いので頭と末尾だけ（全文は title）。 */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 7)}…${id.slice(-3)}` : id
}

export default function FriendAddRunDetailV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunDetailInner />
    </Suspense>
  )
}

function FriendAddRunDetailInner() {
  usePageTitle('友だち追加時配信・実行詳細')
  const searchParams = useSearchParams()
  const runId = searchParams.get('id') ?? ''
  /* 一覧から受け取った絞り込み・ページ位置を戻り先へ引き継ぐ（R268）。 */
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
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
  const [detail, setDetail] = useState<FriendAddRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [missing, setMissing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState('')
  /* 処理の失敗が無い失敗（案内を送れなかった等）は、相手に新しく届くので確かめてから動かす。 */
  const [resendConfirmOpen, setResendConfirmOpen] = useState(false)
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    // アカウントを切り替えた直後は、前のアカウントの詳細を一瞬でも残さない。
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
    setResendConfirmOpen(false)
    try {
      const response = await api.friendAddRules.retryRun(selectedAccountId, detail.id)
      if (!response.success) {
        setNotice('失敗した処理を再試行できませんでした。状態を読み直してください。')
        return
      }
      setNotice(`${response.data.retried}件の失敗処理を再試行しました。`)
      await load()
    } catch (caught) {
      // M011：409 は応答が消えたあとの再送（実際は通っている）ことがあるので、読み直してから文を出す。
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
      return <ListState kind="forbidden" title="実行詳細を表示する権限がありません" description={error} onRetry={() => void load()} />
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

  /* 形の違う応答は空として扱う（そのまま回すと画面ごと落ちる。全ルート監査 A1）。 */
  const actionRuns = Array.isArray(detail.actionRuns) ? detail.actionRuns : []
  const failedActions = actionRuns.filter((action) => action.status === 'failed')
  const firstFailed = actionRuns.findIndex((action) => action.status === 'failed')
  const displayName = detail.friend.displayName || '名前は未取得'
  const friendKindLabel = detail.friendKind === 'first_time' ? 'はじめて' : '再追加・ブロック解除'
  const routeName = detail.attribution.status === 'captured'
    ? detail.attribution.routeName || detail.attribution.reason || '選択した経路'
    : '経路が分からない'
  const ruleLabel = detail.rule ? `${detail.rule.name ?? '名前は未取得'}（第${detail.rule.versionNumber ?? '—'}版）` : '使用ルールは未取得'
  const messageType = detail.rule?.definition?.messageType
  const messageLabel = messageType ? MESSAGE_TYPE_LABEL[messageType] ?? '案内' : '案内'
  const deliveryUnknown = detail.errorCode === DELIVERY_UNKNOWN_CODE
  /* 案内を送らなかった記録（再追加で案内なし・送れなかった）は「案内を送った」を出さない。 */
  const messageSent = detail.status !== 'suppressed' && !deliveryUnknown && !(detail.status === 'failed' && failedActions.length === 0)
  const runFailed = detail.status === 'failed' || detail.status === 'partial_failed'
  const talkHref = !detail.friend.redacted ? `/chats?friend=${encodeURIComponent(detail.friend.id)}` : null
  const settingsHref = detail.rule ? `/friend-add-settings?view=edit&id=${encodeURIComponent(detail.rule.id)}` : null

  const bandTitle = failedActions.length > 0
    ? `${firstFailed + (messageSent ? 2 : 1)}つ目の処理を完了できませんでした`
    : routingAction(detail.status, detail.errorCode)
  const bandNote = failedActions.length > 0
    ? `${messageSent ? '案内は届いています。' : ''}${ACTION_STOPPED_AT[actionRuns[firstFailed]?.type ?? ''] ?? '処理のところ'}で止まりました。`
    : deliveryUnknown
      ? '届いたか分かりません。二重に届かないよう、自動では送り直しません。トークで確かめてください。'
      : '案内を送れませんでした。理由を確かめて、もう一度実行できます。'

  return (
    <PageFrame kind="detail" boardId="N43uVX">
      <PageHeading
        identity={<Link href={listHref} className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />実行結果へ</Link>}
        title={`${displayName}さんの友だち追加`}
        description={`${jstTitleDate(detail.receivedAt)} に追加・${friendKindLabel}`}
      />
      <div className={styles.split}>
        <div className={styles.main}>
          {failedActions.length > 0 || runFailed || deliveryUnknown ? (
            <div className={styles.failBand} role="alert">
              <AlertCircle size={18} className={styles.failIcon} aria-hidden="true" />
              <div className={styles.failText}>
                <p className={styles.failTitle}>{bandTitle}</p>
                <p className={styles.failNote}>{bandNote}</p>
              </div>
              {canManage && !deliveryUnknown && (failedActions.length > 0 || runFailed) ? (
                <Button
                  variant="primary"
                  disabled={retrying}
                  busy={retrying}
                  busyLabel="再試行中…"
                  onClick={() => (failedActions.length > 0 ? void retry() : setResendConfirmOpen(true))}
                >
                  <RotateCcw size={14} aria-hidden="true" />失敗した処理をもう一度
                </Button>
              ) : null}
            </div>
          ) : null}

          <section className={styles.card} aria-labelledby="friend-add-run-steps">
            <div className={styles.cardHead}>
              <h3 id="friend-add-run-steps" className={styles.cardTitle}>行ったこと</h3>
              <p className={styles.cardSub}>設定された処理を、省かずに行った順に出します</p>
            </div>
            <ol className={styles.steps}>
              {messageSent ? (
                <li className={styles.step} data-state="ok">
                  <CheckCircle2 size={18} className={styles.stepIcon} aria-hidden="true" />
                  <span className={styles.stepIndex}>1</span>
                  <span className={styles.stepText}>
                    <span className={styles.stepTitle}>{`案内（${messageLabel}）を送った`}</span>
                    <span className={styles.stepSub}>{`${jstClock(detail.processedAt ?? detail.receivedAt)}・LINE 受付済み`}</span>
                  </span>
                </li>
              ) : null}
              {actionRuns.map((action, index) => {
                const state = action.status === 'completed' ? 'ok' : action.status === 'failed' ? 'ng' : 'wait'
                const message = state === 'ng' ? safeErrorMessage(action.errorCode) : null
                const time = jstClock(action.completedAt ?? action.startedAt)
                return (
                  <li key={action.id} className={styles.step} data-state={state}>
                    {state === 'ok' ? <CheckCircle2 size={18} className={styles.stepIcon} aria-hidden="true" />
                      : state === 'ng' ? <XCircle size={18} className={styles.stepIcon} aria-hidden="true" />
                        : <Clock size={18} className={styles.stepIcon} aria-hidden="true" />}
                    <span className={styles.stepIndex}>{index + (messageSent ? 2 : 1)}</span>
                    <span className={styles.stepText}>
                      <span className={styles.stepTitle}>{actionTitle(action, detail.configuredActions)}</span>
                      <span className={styles.stepSub} data-kind={message || state === 'wait' ? undefined : 'time'}>
                        {message ?? (state === 'wait' ? `${time}・実行を待っています` : action.attemptCount > 1 ? `${time}・${action.attemptCount}回目` : time)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ol>
            {!messageSent && actionRuns.length === 0 ? <p className={styles.cardSub}>行った処理はありません。</p> : null}
          </section>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        </div>

        <aside className={styles.side} aria-label="この追加について">
          <section className={styles.box}>
            <h3 className={styles.boxTitle}>この追加について</h3>
            <dl className={styles.rows}>
              <div className={styles.row}><dt>友だち</dt><dd title={displayName}>{displayName}</dd></div>
              <div className={styles.row}><dt>追加の種類</dt><dd>{friendKindLabel}</dd></div>
              <div className={styles.row}><dt>来た経路</dt><dd title={routeName}>{routeName}</dd></div>
              <div className={styles.row}><dt>動いた設定</dt><dd title={ruleLabel}>{ruleLabel}</dd></div>
              <div className={styles.row}><dt>受けた日時</dt><dd>{jstShortDateTime(detail.receivedAt)}</dd></div>
              <div className={styles.row}><dt>処理した日時</dt><dd>{detail.processedAt ? jstShortDateTime(detail.processedAt) : 'まだ処理していません'}</dd></div>
              <div className={styles.row}><dt>記録ID（お問い合わせ用）</dt><dd className={styles.mono} title={detail.id}>{shortId(detail.id)}</dd></div>
            </dl>
          </section>
          {talkHref || settingsHref ? (
            <div className={styles.sideActions}>
              {talkHref ? <Button href={talkHref}><MessageCircle size={14} aria-hidden="true" />トークを開く</Button> : null}
              {settingsHref ? <Button href={settingsHref}><Settings2 size={14} aria-hidden="true" />設定を開く</Button> : null}
            </div>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={resendConfirmOpen}
        title="失敗した処理をもう一度行いますか？"
        description="届かなかった処理だけをもう一度行います。相手には新しく届きます。"
        confirmLabel="もう一度行う"
        busy={retrying}
        onConfirm={() => void retry()}
        onCancel={() => { if (!retrying) setResendConfirmOpen(false) }}
      />
    </PageFrame>
  )
}
