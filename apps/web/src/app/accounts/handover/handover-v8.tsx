'use client'

/*
 * ★V8-B LINEアカウントの乗り換え（板 `x2dSNv`）。
 *
 * v7 の画面（`page.tsx` の Handover）とは別の部品として持つ。
 * 同じ口・同じ文言・同じ守り（確認の小窓・二重押し防止・権限・
 * 閲覧のみ・競合・失敗時の戻し方）で、見せ方だけ V8 にする。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { LineAccount } from '@line-crm/shared'
import {
  api,
  ApiError,
  type AccountHandover,
  type AccountHandoverDecision,
} from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { notifyToast } from '@/components/shared/toast'
import TargetMissing from '@/components/shared/target-missing'
import { TableHeadRow, Th } from '@/components/shared/table'
import { TextInput } from '@/components/shared/form-controls'
import { useStepUpGate } from '@/components/step-up-prompt'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  DIFFERENT_PROVIDER_NOTE,
  MATCH_BUCKETS,
  totalsMatch,
} from './handover-view'
import { formatDateTime, formatNumber } from '@/lib/format'
import styles from './handover-v8.module.css'

type HandoverDecisionView = AccountHandoverDecision & {
  sourceName?: string
  candidateName?: string | null
  evidenceLabel?: string
}

type HandoverView = AccountHandover & {
  decisions: HandoverDecisionView[]
  unresolvedReviews: number | null
}

const statusStep: Record<AccountHandover['status'], number> = {
  code_issued: 1,
  linked: 2,
  previewed: 3,
  resolved: 4,
  executing: 5,
  completed: 5,
  failed: 5,
  cancelled: 1,
}

function formatMonthDayTime(value: string | null): string {
  if (!value) return '未取得'
  return formatDateTime(new Date(value))
}

/**
 * 見るだけの担当者（staff）には変更の入口を出さない（R522）。
 * 口側は発行・読み取り・事前確認・判断・本実行・取り消し・切り戻しを
 * owner/admin だけに絞っている（`account-handovers.ts` の requireRole）ので、
 * 画面も同じ境目（`canManageRole`）で出し分ける。確認が終わるまで
 * （staffRole === null）は今までどおり出す。
 */
const NO_MANAGE_NOTE = '引き継ぎの変更はオーナーと管理者だけができます。必要なときはオーナーか管理者に頼んでください。'

/** v7 の5段を板の4つの札に対応づける。 */
const STEP_PILLS = ['引き継ぎコード', '事前確認', '要確認を決める', '本実行'] as const

function pillIndex(currentStep: number): number {
  if (currentStep <= 2) return 1
  if (currentStep === 3) return 2
  if (currentStep === 4) return 3
  return 4
}

export default function HandoverV8() {
  const search = useSearchParams()
  const id = search?.get('id') ?? ''
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const [account, setAccount] = useState<LineAccount | null>(null)
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  /** 補助の一覧（受け取り先の名前）だけの失敗。本体は隠さず、ここだけ読み直す（R521）。 */
  const [accountsFailed, setAccountsFailed] = useState(false)
  const [accountsRetrying, setAccountsRetrying] = useState(false)
  const [handover, setHandover] = useState<HandoverView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState('')
  /** 本人確認の窓（X-3: 本実行・切り戻しで使う）。 */
  const { gate: stepUpGate, prompt: stepUpPrompt } = useStepUpGate()
  /** 段1/段2。コードを出す・読む操作の入力と状態。 */
  const [issuing, setIssuing] = useState(false)
  const [linkCode, setLinkCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  /** 段3。移し元システム側の申告件数（運用者入力）。 */
  const [declaredTotalInput, setDeclaredTotalInput] = useState('')
  /** 段6。切り戻し。 */
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackError, setRollbackError] = useState('')
  /** 段4。人が書き換えた判断（保存するまで下書き）。 */
  const [decisionEdits, setDecisionEdits] = useState<Record<string, 'link' | 'new' | 'skip'>>({})
  const [savingDecisions, setSavingDecisions] = useState(false)
  const [decisionError, setDecisionError] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  /**
   * 補助の一覧（受け取り先の名前）だけを読む。本体とは成否を分ける。
   * ここが503でも引継ぎの内容は隠さない（R521）。成功したら印を消す。
   */
  const loadAccounts = useCallback(async () => {
    try {
      const accountsRes = await api.lineAccounts.list()
      if (!accountsRes.success) {
        setAccountsFailed(true)
        return
      }
      setAccounts(accountsRes.data)
      setAccountsFailed(false)
    } catch {
      setAccountsFailed(true)
    }
  }, [])

  /** 補助の一覧だけ読み直す。二度押しを止める。 */
  const retryAccounts = useCallback(async () => {
    if (accountsRetrying) return
    setAccountsRetrying(true)
    try {
      await loadAccounts()
    } finally {
      setAccountsRetrying(false)
    }
  }, [accountsRetrying, loadAccounts])

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    setMissing(false)
    /*
      補助の一覧は本体と並行に読むが、成否は分けて持つ。ここが失敗しても
      下の本体の読み込みは続け、画面全体を失敗にしない（R521）。
    */
    void loadAccounts()
    try {
      const [accountRes, handoversRes] = await Promise.all([
        api.lineAccounts.get(id),
        api.accountHandovers.listForAccount(id),
      ])
      if (!accountRes.success || !handoversRes.success) {
        setStatus('error')
        return
      }
      setAccount(accountRes.data)
      const current = handoversRes.data[0]
      if (!current) {
        setHandover(null)
        setStatus('ready')
        return
      }
      const detailRes = await api.accountHandovers.get(current.id)
      if (!detailRes.success) {
        setStatus('error')
        return
      }
      setHandover(detailRes.data as HandoverView)
      setDeclaredTotalInput(
        detailRes.data.declaredFriendTotal !== null
          && detailRes.data.declaredFriendTotal !== undefined
          ? String(detailRes.data.declaredFriendTotal)
          : '',
      )
      setDecisionEdits({})
      setStatus('ready')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
        setStatus('ready')
        return
      }
      setStatus('error')
    }
  }, [id, loadAccounts])

  useEffect(() => { void load() }, [load])
  usePageTitle('乗り換え・引き継ぎ')

  const destination = accounts.find((item) => item.id === handover?.toAccountId) ?? null
  const countsAreComplete = handover?.counts
    ? totalsMatch(handover.counts, handover.counts.sourceTotal)
    : false

  const rerunPreview = async () => {
    if (!handover?.counts || !countsAreComplete) return
    setRefreshing(true)
    try {
      const { sourceTotal, auto, review, unmatched, lookalike } = handover.counts
      const declared = declaredTotalInput.trim()
      const result = await api.accountHandovers.preview(handover.id, {
        sourceFriendTotal: sourceTotal,
        counts: { auto, review, unmatched, lookalike },
        declaredFriendTotal: declared === '' ? null : Number(declared),
      })
      if (!result.success) return
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) setHandover(detail.data as HandoverView)
    } finally {
      setRefreshing(false)
    }
  }

  /** 段1。このアカウントを移し元にしてコードを出す。 */
  const issueCode = async () => {
    if (issuing) return
    setIssuing(true)
    try {
      const res = await api.accountHandovers.issue(account!.id)
      if (!res.success) throw new Error(res.error)
      await load()
    } catch {
      setExecuteError('引き継ぎコードを発行できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setIssuing(false)
    }
  }

  /** 段2。このアカウントを受け取り先にしてコードを読む。 */
  const submitLinkCode = async () => {
    const code = linkCode.trim()
    if (!code || linking) return
    setLinking(true)
    setLinkError('')
    try {
      const res = await api.accountHandovers.link(code, account!.id)
      if (!res.success) throw new Error(res.error)
      setLinkCode('')
      // コードを読んだ側は「受け取り先」。一覧は移し元側の画面なので、
      // 移し元の画面を開き直す。
      const detail = await api.accountHandovers.get(res.data.id)
      if (detail.success && detail.data.fromAccountId) {
        window.location.href = `/accounts/handover?id=${detail.data.fromAccountId}`
        return
      }
      await load()
    } catch (caught) {
      setLinkError(
        caught instanceof ApiError && caught.message && !/^API error: /.test(caught.message)
          ? caught.message
          : 'コードを読めませんでした。期限（72時間）を過ぎていないか、書き写しを確かめてください。',
      )
    } finally {
      setLinking(false)
    }
  }

  /** 段4。人が書き換えた判断を保存する。 */
  const saveDecisions = async () => {
    if (!handover || savingDecisions) return
    const changed = handover.decisions.filter((d) => decisionEdits[d.id] !== undefined)
    if (changed.length === 0) return
    setSavingDecisions(true)
    setDecisionError('')
    try {
      const res = await api.accountHandovers.saveDecisions(handover.id, changed.map((d) => ({
        fromFriendId: d.from_friend_id,
        toFriendId: decisionEdits[d.id] === 'link' ? d.to_friend_id : null,
        decision: decisionEdits[d.id]!,
        bucket: d.bucket,
        note: d.note ?? null,
      })))
      if (!res.success) throw new Error(res.error)
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) {
        setHandover(detail.data as HandoverView)
        setDecisionEdits({})
      }
    } catch (caught) {
      setDecisionError(
        caught instanceof ApiError && caught.message && !/^API error: /.test(caught.message)
          ? caught.message
          : '判断を保存できませんでした。しばらくおいてから、もう一度お試しください。',
      )
    } finally {
      setSavingDecisions(false)
    }
  }

  /** 段6。切り戻し。本実行から7日間だけ。 */
  const runRollback = async () => {
    if (!handover || rollingBack) return
    setRollingBack(true)
    setRollbackError('')
    try {
      const token = await stepUpGate('account_handover.execute', '引き継ぎの切り戻し')
      if (token === null) { setRollingBack(false); return }
      const res = await api.accountHandovers.rollback(handover.id, undefined, token)
      if (!res.success) throw new Error(res.error)
      setRollbackOpen(false)
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) setHandover(detail.data as HandoverView)
      notifyToast(`切り戻しました。${formatNumber(res.data.restoredCount)}人を元のアカウントへ戻しました。`)
    } catch (caught) {
      setRollbackError(
        caught instanceof ApiError && caught.message && !/^API error: /.test(caught.message)
          ? caught.message
          : '切り戻せませんでした。期限（7日間）を過ぎていないか確かめてください。',
      )
    } finally {
      setRollingBack(false)
    }
  }

  /** 進行中の引き継ぎを取り消す。終わった引き継ぎは消せない。 */
  const runCancel = async () => {
    if (!handover || cancelling) return
    setCancelling(true)
    try {
      const res = await api.accountHandovers.cancel(handover.id)
      if (!res.success) throw new Error(res.error)
      setCancelOpen(false)
      await load()
    } catch {
      setExecuteError('取り消せませんでした。しばらくおいてから、もう一度お試しください。')
      setCancelOpen(false)
    } finally {
      setCancelling(false)
    }
  }

  const copyCode = async () => {
    if (!handover?.code) return
    await navigator.clipboard.writeText(handover.code)
    setCopyState('copied')
  }

  /**
   * 段5。本実行。**確認窓なしでは進めない。**
   * 決め残し・実行ずみは口側でも止めるが、画面でも押せない形にする。
   */
  const executeHandover = async () => {
    if (!handover || executing) return
    setExecuting(true)
    setExecuteError('')
    try {
      // 友だちを実際に動かす操作。本人確認（step-up）を済ませてから進める（X-3）。
      const token = await stepUpGate('account_handover.execute', '友だちの引き継ぎを本実行する')
      if (token === null) { setExecuting(false); return }
      const result = await api.accountHandovers.execute(handover.id, token)
      if (!result.success) {
        setExecuteError(result.error)
        return
      }
      setConfirmOpen(false)
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) setHandover(detail.data as HandoverView)
      const moved = result.data.movedCount ?? result.data.plannedCount ?? 0
      notifyToast(
        result.data.failureReason
          ?? `本実行が終わりました。${formatNumber(moved)}人を移しました。`,
      )
    } catch {
      setExecuteError('本実行できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setExecuting(false)
    }
  }

  /*
    `?id=` なしで開くと読み込みが始まらず「読み込んでいます」が消えない。
    対象未指定は失敗ではないので、一覧へ戻して選び直させる（U097系）。
  */
  if (!id) {
    return (
      <div className={styles.board} data-design-node="x2dSNv">
        <TargetMissing
          kind="unspecified"
          title="乗り換えるアカウントが指定されていません"
          description="LINEアカウントの一覧からアカウントを選び、詳細の「乗り換え」から進んでください。"
          backHref="/accounts"
          backLabel="LINEアカウントの一覧へ戻る"
        />
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className={styles.board} data-design-node="x2dSNv">
        <ListState kind="loading" />
      </div>
    )
  }
  if (missing || (status === 'ready' && !account)) {
    return (
      <div className={styles.board} data-design-node="x2dSNv">
        <TargetMissing
          kind="not-found"
          title="このアカウントは見つかりません"
          description="削除されたか、別の記録です。一覧から選び直してください。"
          backHref="/accounts"
          backLabel="LINEアカウントの一覧へ戻る"
        />
      </div>
    )
  }
  if (status === 'error' || !account) {
    return (
      <div className={styles.board} data-design-node="x2dSNv">
        <TargetMissing
          kind="error"
          title="乗り換えの情報を読み込めませんでした"
          description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
          onRetry={() => void load()}
        />
      </div>
    )
  }

  // 段1・段2の入口。出す側と受け取る側の両方の口を出す。
  if (!handover) {
    return (
      <div className={styles.board} data-design-node="x2dSNv">
        <div className={styles.head}>
          <div>
            <h2 className={styles.headTitle}>乗り換え（{account.name}）</h2>
            <p className={styles.headDescription}>
              引き継ぎコードで両方のアカウントをつなぎます。コードを出すだけ・読むだけでは何も変わりません。
            </p>
          </div>
          <Button href={`/accounts/detail?id=${account.id}`}>← アカウントの詳細へ戻る</Button>
        </div>
        {!canManage && (
          <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed">
            {NO_MANAGE_NOTE}引き継ぎの状態はこのまま見られます。
          </p>
        )}
        <div className={styles.duo}>
          <div className={styles.card}>
            <p className={styles.cardTitle}>このアカウントから移す</p>
            <p className={styles.cardNote}>
              引き継ぎコードを発行します。コードの期限は72時間で、1回だけ使えます。発行するだけでは何も変わりません。
            </p>
            {executeError && <Notice tone="danger" className="mt-3"><p>{executeError}</p></Notice>}
            {canManage && (
              <Button type="button" variant="primary" className="mt-3" disabled={issuing}
                onClick={() => { setExecuteError(''); void issueCode() }} busy={issuing} busyLabel="発行中…">引き継ぎコードを出す
              </Button>
            )}
          </div>
          <div className={styles.card}>
            <p className={styles.cardTitle}>このアカウントへ移す</p>
            <p className={styles.cardNote}>
              移し元のアカウントで発行した引き継ぎコードを入れてください。読んだだけでは友だちは動きません。あとで事前確認をします。
            </p>
            {canManage && (
              <div className="mt-3 flex items-start gap-2">
                <TextInput
                  className="flex-1"
                  placeholder="引き継ぎコード"
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value)}
                  disabled={linking}
                  aria-label="引き継ぎコード"
                />
                <Button type="button" variant="primary" disabled={linking || !linkCode.trim()}
                  onClick={() => void submitLinkCode()} busy={linking} busyLabel="確認中…">コードを読む
                </Button>
              </div>
            )}
            {linkError && <p role="alert" className="text-danger mt-2 text-xs">{linkError}</p>}
          </div>
        </div>
      </div>
    )
  }

  const currentStep = statusStep[handover.status]
  const pill = pillIndex(currentStep)
  const unresolved = handover.unresolvedReviews ?? 0
  const reviewTotal = handover.counts?.review ?? null
  const decided = reviewTotal !== null ? reviewTotal - unresolved : null
  const declaredMismatch = handover.declaredFriendTotal !== null
    && handover.declaredFriendTotal !== undefined
    && handover.counts !== null
    && handover.declaredFriendTotal !== handover.counts.sourceTotal
  const executeDisabled = unresolved > 0
    || handover.status === 'completed'
    || Object.keys(decisionEdits).length > 0
    || declaredMismatch

  return (
    <div className={styles.board} data-design-node="x2dSNv">
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>乗り換え（{account.name} → {destination?.name ?? '未取得'}）</h2>
          <p className={styles.headDescription}>
            引き継ぎコードで両方のアカウントをつなぎました。「要確認」を全部決めるまで本実行できません。
          </p>
        </div>
        <Button href={`/accounts/detail?id=${account.id}`}>← アカウントの詳細へ戻る</Button>
      </div>
      {!canManage && (
        <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed">
          {NO_MANAGE_NOTE}引き継ぎの状態はこのまま見られます。
        </p>
      )}

      <ol className={styles.steps}>
        {STEP_PILLS.map((label, index) => {
          const order = index + 1
          const done = order < pill
          const active = order === pill
          return (
            <li key={label} className={`${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}>
              <span className={styles.stepNumber}>{done ? '✓' : order}</span>
              <span>{order} {label}</span>
            </li>
          )
        })}
      </ol>

      <div className={styles.duo}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>どこからどこへ</p>
          <p className={styles.routeLine}>
            {account.name}（引き継ぎ元・元データを残す） → {destination?.name ?? '未取得'}（引き継ぎ先）
          </p>
          <p className={styles.cardNote}>
            プロバイダーが違うので、友だちのIDは自動でつなげません
          </p>
          <p className={styles.cardNote}>
            コード：{handover.code} <Button type="button" variant="secondary" size="compact" onClick={() => void copyCode()}>
              {copyState === 'copied' ? 'コピーしました' : 'コピー'}
            </Button>
          </p>
          {accountsFailed && (
            <Notice
              tone="warn"
              className="mt-3"
              message="受け取り先の一覧だけ読み込めませんでした。引き継ぎの内容はそのまま見られます。"
              action={(
                <Button
                  type="button"
                  variant="secondary"
                  disabled={accountsRetrying}
                  onClick={() => void retryAccounts()}
                  busy={accountsRetrying}
                  busyLabel="読み込んでいます"
                >
                  一覧だけ読み直す
                </Button>
              )}
            />
          )}
          {handover.providerMatch === 'different' && (
            <Notice tone="warn" className="mt-3">
              <p className="font-bold">プロバイダーが違うので、友だちのIDは自動でつなげません</p>
              <p className="mt-1">{DIFFERENT_PROVIDER_NOTE.replace('プロバイダーが違うので、友だちのIDは自動でつなげません。', '')}</p>
            </Notice>
          )}
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>事前確認の結果</p>
          <p className={styles.cardNote}>
            元の友だち {countsAreComplete && handover.counts ? `${handover.counts.sourceTotal}人` : '—'}：
            {MATCH_BUCKETS.map((bucket) => `${bucket.label} ${countsAreComplete ? `${handover.counts?.[bucket.key]}人` : '—'}`).join('・')}
          </p>
          {canManage && (
            <div className="mt-3">
              <label className="block">
                <span className="text-ink-faint text-xs">
                  移し元システムが言う友だち数（申告。分からなければ空欄）
                </span>
                <TextInput
                  type="number"
                  min={0}
                  className="mt-1 w-40"
                  placeholder="例: 231"
                  value={declaredTotalInput}
                  onChange={(e) => setDeclaredTotalInput(e.target.value)}
                  disabled={refreshing || !handover.counts}
                />
              </label>
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                申告の数と事前確認の合計が違うままでは、本実行しません。
              </p>
            </div>
          )}
          {declaredMismatch && (
            <Notice tone="warn" className="mt-3">
              <p className="font-bold">申告の数（{handover.declaredFriendTotal}人）と事前確認の合計（{handover.counts?.sourceTotal ?? '—'}人）が違います</p>
              <p className="mt-1">差の理由を確かめてから、件数を直すか事前確認をやり直してください。</p>
            </Notice>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>要確認 {handover.counts?.review ?? '—'}人の判断</p>
        <p className={styles.cardNote}>「要確認」を全部決めるまで本実行できません。決めた内容はあとから見返せます。</p>
        <div className={styles.tableScroll}>
          <table className="w-full min-w-full text-left">
            <thead>
              <TableHeadRow>
                <Th>元の友だち</Th>
                <Th>受け取り先の候補</Th>
                <Th>つないだ根拠</Th>
                <Th>この人の判断</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {handover.decisions.map((decision) => {
                const shown = decisionEdits[decision.id] ?? decision.decision
                /*
                  人が決める段（X-3）。「要確認」「別人の可能性」の行は
                  書き換えられる。同じ人（link）は候補がいるときだけ。
                  見るだけの担当者には書き換えを出さず、決めた内容だけ見せる。
                */
                const editable = canManage && (decision.bucket === 'review' || decision.bucket === 'lookalike')
                return (
                  <tr key={decision.id} className="text-sm">
                    <td className="px-4 py-3 font-medium">{decision.sourceName ?? decision.from_friend_id}</td>
                    <td className="px-4 py-3">{decision.candidateName ?? '候補なし'}</td>
                    <td className="text-ink-secondary px-4 py-3 text-xs">{decision.evidenceLabel ?? decision.note ?? '未取得'}</td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <Select
                          size="page-size"
                          className="text-xs"
                          aria-label="この人の判断"
                          value={shown}
                          disabled={savingDecisions}
                          onChange={(value) => setDecisionEdits((prev) => ({
                            ...prev,
                            [decision.id]: value as 'link' | 'new' | 'skip',
                          }))}
                          options={[
                            ...(decision.to_friend_id || shown === 'link'
                              ? [{ value: 'link', label: '同じ人' }]
                              : []),
                            { value: 'new', label: '新しく作る' },
                            { value: 'skip', label: '引き継がない' },
                          ]}
                        />
                      ) : (
                        <span className="border-hairline rounded-pill border px-2 py-1 text-xs">
                          {shown === 'link' ? '同じ人' : shown === 'new' ? '新しく作る' : '引き継がない'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-ink-secondary border-hairline border-t px-5 py-3 text-xs">
          残り {handover.unresolvedReviews ?? '—'}人。名前と画像だけの一致では、自動で同じ人にしません。
        </p>
      </div>

      {canManage && Object.keys(decisionEdits).length > 0 && (
        <div className={styles.unsavedBand}>
          {decisionError
            ? <p role="alert" className="text-danger text-xs">{decisionError}</p>
            : <p className={styles.unsavedText}>{Object.keys(decisionEdits).length}件の書き換えをまだ保存していません。保存するまで本実行へ進めません。</p>}
          <div className={styles.unsavedActions}>
            <Button type="button" variant="secondary" disabled={refreshing || !countsAreComplete} onClick={() => void rerunPreview()} busy={refreshing} busyLabel="確認中…">
              事前確認をやり直す
            </Button>
            <Button type="button" variant="primary" disabled={savingDecisions}
              onClick={() => void saveDecisions()} busy={savingDecisions}>判断を保存する
            </Button>
          </div>
        </div>
      )}

      <div className={styles.duo}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>戻せること</p>
          <ul className={styles.promiseList}>
            <li>7日以内は、今回作った対応付けだけを戻せます</li>
            <li>引き継ぎ後に増えた履歴や配信拒否は消しません</li>
            <li>送信済みのメッセージは取り消せません</li>
          </ul>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>気をつけること</p>
          <ul className={styles.promiseList}>
            <li>本実行しても、元のアカウントの友だち・履歴・元のIDと所属は残します</li>
            <li>本実行の前に、控えと戻し先の目印を作ります</li>
            <li>送信を止める設定と同意状態は、厳しいほうを引き継ぎます</li>
            <li>名前と画像だけが似ている組は、自動では同じ人にしません</li>
            <li>配信の切り替えは、別に確かめてから行います（この実行では切り替えません）</li>
          </ul>
        </div>
      </div>

      {executeError && (
        <Notice tone="danger" message={executeError} onClose={() => setExecuteError('')} className="mt-3" />
      )}
      <div className={styles.bottomBar}>
        <div>
          {unresolved > 0 ? (
            <p className={styles.bottomNote}>
              未判断が {unresolved}人残っています{reviewTotal !== null && decided !== null ? `（要確認 ${reviewTotal}人のうち ${decided}人を決めた）` : ''}。全員を決めると本実行できます
            </p>
          ) : null}
        </div>
        <div className={styles.bottomActions}>
          {/* 取り消しは進行中だけ。終わった引き継ぎは切り戻しで戻す。変更なので見るだけには出さない。 */}
          {canManage && handover.status !== 'completed' && handover.status !== 'failed' && (
            <Button type="button" variant="secondary"
              onClick={() => setCancelOpen(true)}>
              引き継ぎをやめる
            </Button>
          )}
          {canManage && (
            <>
              <Button type="button" variant="secondary" disabled={refreshing || !countsAreComplete} onClick={() => void rerunPreview()} busy={refreshing} busyLabel="確認中…">
                事前確認をやり直す
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={executeDisabled}
                onClick={() => { setExecuteError(''); setConfirmOpen(true) }} busy={executing} busyLabel="実行中…">
                ▶ 本実行する{unresolved > 0 ? `（あと${unresolved}人）` : ''}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 切り戻し（X-3）。本実行から7日間だけ、終わった引き継ぎを戻せる。変更なので見るだけには出さない。 */}
      {canManage && handover.status === 'completed' && !handover.rolledBackAt && handover.rollbackDeadline
        && handover.rollbackDeadline > new Date().toISOString() && (
        <div className="border-hairline rounded-control flex flex-wrap items-center justify-between gap-2 border px-4 py-3">
          <div>
            <p className="text-ink text-sm font-semibold">移した友だちを元へ戻す</p>
            <p className="text-ink-secondary mt-1 text-xs">
              {formatMonthDayTime(handover.rollbackDeadline)} まで切り戻せます。動かした友だちだけを元のアカウントへ戻します。
            </p>
          </div>
          <Button type="button" variant="danger" onClick={() => { setRollbackError(''); setRollbackOpen(true) }}>
            切り戻す
          </Button>
        </div>
      )}
      {handover.rolledBackAt && (
        <Notice tone="info">
          <p>切り戻し済みです（{formatMonthDayTime(handover.rolledBackAt)}）。{handover.rollbackNote ? `理由: ${handover.rollbackNote}` : ''}</p>
        </Notice>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="本実行しますか？"
        description={`要確認はすべて決めました。本実行すると、決めた内容で友だちが「${destination?.name ?? '受け取り先'}」へ移ります。元のアカウントの友だち・履歴・配信は消しません。`}
        confirmLabel={executing ? '実行中…' : '本実行する'}
        busy={executing}
        error={executeError}
        onConfirm={() => void executeHandover()}
        onCancel={() => { if (!executing) { setConfirmOpen(false); setExecuteError('') } }}
      />
      <ConfirmDialog
        open={cancelOpen}
        title="この引き継ぎを取り消しますか？"
        description="進行中の引き継ぎをやめます。コードは使えなくなり、決めた内容は破棄されます。元のアカウントの友だちは変わりません。"
        confirmLabel={cancelling ? '取り消し中…' : '引き継ぎを取り消す'}
        destructive
        busy={cancelling}
        onConfirm={() => void runCancel()}
        onCancel={() => { if (!cancelling) setCancelOpen(false) }}
      />
      <ConfirmDialog
        open={rollbackOpen}
        title="移した友だちを元へ戻しますか？"
        description={`本実行で「${destination?.name ?? '受け取り先'}」へ移した友だちを、元の「${account.name}」へ戻します。移したあとで人が動かした人は戻しません。`}
        confirmLabel={rollingBack ? '戻し中…' : '切り戻す'}
        destructive
        busy={rollingBack}
        error={rollbackError}
        onConfirm={() => void runRollback()}
        onCancel={() => { if (!rollingBack) { setRollbackOpen(false); setRollbackError('') } }}
      />
      {stepUpPrompt}
    </div>
  )
}
