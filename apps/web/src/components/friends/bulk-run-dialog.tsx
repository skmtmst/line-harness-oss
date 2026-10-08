'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tag, Send, UserRound, CircleCheck, Bell, Zap, Play, Square } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import Stepper from '@/components/shared/stepper'
import { Steps } from '@/components/templates/steps'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { TableHeadRow, Th, Td } from '@/components/shared/table'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import { ApiError, api } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import type {
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunDetail,
  FriendBulkSelection,
} from '@line-crm/shared'
import {
  ITEM_GROUPS, OPERATIONS, blockedReason, canExecute, canRetry, canUndo, countText,
  failureOf, isRunComplete, itemStatusLabel, operationLabel, type Failure,
} from './bulk-run-view'
import styles from './bulk-run-dialog.module.css'
import { formatNumber } from '@/lib/format'
import BulkOperationEditor from './bulk-operation-editor'
import { buildBulkOperation, EMPTY_BULK_INPUT, type BulkOperationInput } from './bulk-operation-input'

type Phase = 'operation' | 'confirm' | 'result'
type ResultState = 'idle' | 'loading' | 'ready' | 'error'
type ResultAction = 'execute' | 'retry' | 'undo'

const RESULT_POLL_INTERVAL_MS = 750
const RESULT_POLL_LIMIT = 40

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 友だちの一括操作（設計 `IAf7j`）。
 *
 * 流れは **対象選択 → 操作選択 → サーバーで対象を再計算 → 最終確認 → 結果**。
 * **選んだ人数がそのまま対象になるとは限らない。** 除外はサーバーが決めるので、
 * 実行前に必ず数え直した結果を見せる。
 */
export default function BulkRunDialog({
  open,
  friendIds,
  selectedFriends,
  tags,
  accountId,
  supportMarksEnabled = true,
  onClose,
  onDone,
}: {
  open: boolean
  friendIds: string[]
  selectedFriends: FriendListItem[]
  tags: Array<{ id: string; name: string }>
  accountId: string | null
  supportMarksEnabled?: boolean
  onClose: () => void
  onDone: () => void
}) {
  const v8 = useAdminTheme() === 'v8'
  const [phase, setPhase] = useState<Phase>('operation')
  const [operationKind, setOperationKind] = useState<FriendBulkOperation['kind']>('add_tag')
  const [input, setInput] = useState<BulkOperationInput>(EMPTY_BULK_INPUT)
  const [preview, setPreview] = useState<FriendBulkPreview | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error' | 'forbidden'>('idle')
  const [detail, setDetail] = useState<FriendBulkRunDetail | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [irreversibleConfirmed, setIrreversibleConfirmed] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [resultState, setResultState] = useState<ResultState>('idle')
  const [resultAction, setResultAction] = useState<ResultAction>('execute')

  /*
    **遅い返事を別の対象へ映さない。**
    アカウント・対象の組み合わせ・世代の3つが一致したときだけ受け取る。
  */
  const requestRef = useRef<{ accountId: string | null; targetKey: string; generation: number }>({
    accountId: null, targetKey: '', generation: 0,
  })
  const resultRequestRef = useRef(0)
  const createKeysRef = useRef(new IdempotencyKeyStore())
  const undoKeysRef = useRef(new IdempotencyKeyStore())
  const didChangeRef = useRef(false)

  const targetKey = friendIds.join('\u001f')
  const contextRef = useRef({ accountId, targetKey, open })
  contextRef.current = { accountId, targetKey, open }
  const selection = useMemo<FriendBulkSelection>(
    () => ({ kind: 'explicit', friendIds: [...friendIds] }),
    [friendIds],
  )
  const chosen = OPERATIONS.find((o) => o.kind === operationKind)
  const reversible = preview?.reversible ?? chosen?.reversible ?? false

  const operation = useCallback(() => buildBulkOperation(operationKind, input), [operationKind, input])

  const loadPreview = useCallback(async () => {
    const op = operation()
    if (!op || friendIds.length === 0) return
    requestRef.current = {
      accountId,
      targetKey,
      generation: requestRef.current.generation + 1,
    }
    const at = { ...requestRef.current }
    const stillHere = () =>
      contextRef.current.open
      && contextRef.current.accountId === at.accountId
      && contextRef.current.targetKey === at.targetKey
      && requestRef.current.generation === at.generation

    setPreviewState('loading')
    setFailure(null)
    try {
      /* **対象はサーバーが数え直す。** 画面の選択数を実行数として扱わない。 */
      const res = await api.friends.bulkPreview(selection, op)
      if (!stillHere()) return
      if (!res.success) throw new Error('failed')
      setPreview(res.data)
      setPreviewState('idle')
      setPhase('confirm')
    } catch (err) {
      if (!stillHere()) return
      const status = err instanceof ApiError ? err.status : undefined
      /* 権限不足は取得失敗と別。候補も個人情報も描かない。 */
      setPreviewState(status === 403 ? 'forbidden' : 'error')
      setPreview(null)
    }
  }, [accountId, friendIds, operation, selection, targetKey])

  const pollRun = useCallback(async (id: string, action: ResultAction) => {
    const generation = resultRequestRef.current + 1
    resultRequestRef.current = generation
    setRunId(id)
    setResultAction(action)
    setResultState('loading')
    setFailure(null)

    for (let attempt = 0; attempt < RESULT_POLL_LIMIT; attempt += 1) {
      try {
        const response = await api.friends.bulkGet(id)
        if (resultRequestRef.current !== generation) return
        if (!response.success) throw new Error('failed')
        setDetail(response.data)
        if (isRunComplete(response.data.status)) {
          setResultState('ready')
          return
        }
      } catch (error) {
        if (resultRequestRef.current !== generation) return
        setResultState('error')
        setFailure(failureOf({
          status: error instanceof ApiError ? error.status : undefined,
          action: 'detail',
        }))
        return
      }
      await wait(RESULT_POLL_INTERVAL_MS)
      if (resultRequestRef.current !== generation) return
    }

    if (resultRequestRef.current === generation) {
      setResultState('error')
      setFailure({
        kind: 'failure',
        message: '処理は受け付けていますが、まだ終わっていません。少し待ってから結果を読み直してください。',
        canReload: true,
      })
    }
  }, [])

  useEffect(() => {
    /*
      閉じたときだけでなく、アカウントや対象が変わった瞬間に古い返事を無効にする。
      次のpreviewを押すまで世代を進めないと、切替前の遅い返事が新しい画面へ入る。
    */
    setPhase('operation'); setPreview(null); setDetail(null); setRunId(null)
    setInput(EMPTY_BULK_INPUT)
    setFailure(null); setIrreversibleConfirmed(false); setPreviewState('idle')
    setResultState('idle'); setResultAction('execute'); setBusy(false)
    requestRef.current = {
      accountId,
      targetKey,
      generation: requestRef.current.generation + 1,
    }
    resultRequestRef.current += 1
    didChangeRef.current = false
  }, [accountId, open, targetKey])

  if (!open) return null

  const execute = async () => {
    const op = operation()
    if (!op) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    const signature = JSON.stringify({ selection, operation: op })
    setBusy(true)
    setFailure(null)
    try {
      /*
        Workerが受け付けるのはUUID。返事を受け取れなかった再試行では同じ鍵を使い、
        同じ操作を二重に作らない。受付成功が分かってからだけ鍵を捨てる。
      */
      const key = createKeysRef.current.get(signature)
      const res = await api.friends.bulkCreate(selection, op, {
        idempotencyKey: key,
        ...(reversible ? {} : { confirmIrreversible: true }),
      })
      if (!res.success) throw new Error('failed')
      createKeysRef.current.clear(signature)
      if (!stillHere()) {
        onDone()
        return
      }
      didChangeRef.current = true
      setPhase('result')
      setDetail(null)
      void pollRun(res.data.id, 'execute')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'create',
      }))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!detail) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    setBusy(true); setFailure(null)
    try {
      /* **やり直すのは失敗した対象だけ。** 成功済みには触らない。 */
      const res = await api.friends.bulkRetry(detail.id)
      if (!res.success) throw new Error('failed')
      if (!stillHere()) {
        onDone()
        return
      }
      setDetail(null)
      void pollRun(detail.id, 'retry')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'retry',
      }))
    } finally { setBusy(false) }
  }

  const undo = async () => {
    if (!detail) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    const signature = `undo:${detail.id}`
    setBusy(true); setFailure(null)
    try {
      const res = await api.friends.bulkUndo(detail.id, undoKeysRef.current.get(signature))
      if (!res.success) throw new Error('failed')
      undoKeysRef.current.clear(signature)
      if (!stillHere()) {
        onDone()
        return
      }
      didChangeRef.current = true
      setDetail(null)
      /* 取り消しは別の実行。元のIDではなく、返された取消実行IDを追う。 */
      void pollRun(res.data.id, 'undo')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'undo',
      }))
    } finally { setBusy(false) }
  }

  const close = () => {
    requestRef.current = { ...requestRef.current, generation: requestRef.current.generation + 1 }
    resultRequestRef.current += 1
    if (didChangeRef.current) {
      didChangeRef.current = false
      onDone()
    }
    onClose()
  }

  const reloadFailure = () => {
    if (phase === 'result' && runId) void pollRun(runId, resultAction)
    else void loadPreview()
  }

  const blocked = blockedReason({ preview, reversible, irreversibleConfirmed })
  const resultTitle = resultAction === 'undo'
    ? '取り消し'
    : resultAction === 'retry'
      ? 'やり直し'
      : detail
        ? operationLabel(detail.operation.kind)
        : '一括操作'
  const resultComplete = detail ? isRunComplete(detail.status) : false
  const groups = [
    { label: 'よく使う', operations: [
      { kind: 'add_tag', label: 'タグを付ける', Icon: Tag },
      { kind: 'send_message', label: 'メッセージを送る', Icon: Send },
      { kind: 'assign_operator', label: '担当者を変更', Icon: UserRound },
    ] },
    { label: 'タグ・シナリオ', operations: [
      { kind: 'remove_tag', label: 'タグを外す', Icon: Tag },
      { kind: 'start_scenario', label: 'シナリオを開始', Icon: Play },
      { kind: 'stop_scenario', label: 'シナリオを停止', Icon: Square },
    ] },
    { label: '対応・その他', operations: [
      { kind: 'set_support', label: '対応マークを変更', Icon: CircleCheck },
      { kind: 'set_reminder', label: 'リマインダーを設定', Icon: Bell },
      { kind: 'run_common_action', label: 'アクションを実行', Icon: Zap },
    ] },
  ] as const
  const selectedOperation = groups.flatMap((group) => [...group.operations]).find((item) => item.kind === operationKind)
  const OperationIcon = selectedOperation?.Icon ?? Tag
  const operationSummary = operationKind === 'send_message' ? input.content
    : operationKind === 'set_reminder' ? `${input.resourceName}・${input.targetDate.replace('T', ' ')}（日本時間）`
      : input.resourceName
  const phaseIndex = ['operation', 'confirm', 'result'].indexOf(phase)
  const footer = (
    <div className={styles.footer}>
      <span className={styles.hint}>手順 {phaseIndex + 1} / 3</span>
      <div className={styles.actions}>
        {phase === 'operation' ? <>
          <Button onClick={close}>閉じる</Button>
          <Button variant="primary" disabled={!operation() || previewState === 'loading'} onClick={() => void loadPreview()} busy={previewState === 'loading'}>実行内容を確認 →</Button>
        </> : null}
        {phase === 'confirm' && preview ? <>
          <Button onClick={() => setPhase('operation')} disabled={busy}>← 戻る</Button>
          <Button variant="primary" disabled={!canExecute({ preview, busy, irreversibleConfirmed, reversible })} onClick={() => void execute()} busy={busy} busyLabel="実行中…">{`${countText(preview.targetCount, '人')}に実行する`}</Button>
        </> : null}
        {phase === 'result' ? <>
          {resultState === 'ready' && canUndo(detail) ? <Button onClick={() => void undo()} disabled={busy}>取り消す</Button> : null}
          {resultState === 'ready' && canRetry(detail) ? <Button onClick={() => void retry()} disabled={busy}>失敗した{countText(detail?.temporaryFailureCount, '人')}だけやり直す</Button> : null}
          {runId ? <Button onClick={() => void pollRun(runId, resultAction)} disabled={busy || resultState === 'loading'}>読み直す</Button> : null}
          <Button variant="primary" onClick={close} disabled={busy}>← 友だち一覧へ戻る</Button>
        </> : null}
      </div>
    </div>
  )

  const phaseSteps = (['operation', 'confirm', 'result'] as const).map((key, index) => ({
    key,
    label: ['操作を選ぶ', '確かめる', '結果'][index],
    state: index < phaseIndex ? 'done' as const : 'todo' as const,
  }))

  return (
    <Dialog open={open} title="友だちを一括操作" description="対象を確認してから操作を選んでください" onCancel={close} busy={busy} footer={footer} designNode="CYJ0L">
      <div className={styles.panel} data-design-node="IAf7j">
        {/* ★V8 は型の共通部品 Steps（Fa8ED）。v7 はこれまでの Stepper。 */}
        {v8
          ? <Steps label="一括操作の手順" currentKey={phase} steps={phaseSteps} />
          : <Stepper label="一括操作の手順" currentKey={phase} steps={phaseSteps} />}

        {failure ? (
          <div className={phase === 'result' || failure.kind === 'forbidden' ? styles.notice : styles.warn} role="alert" data-failure-kind={failure.kind}>
            <p>{failure.message}</p>
            {failure.canReload ? <Button onClick={reloadFailure}>読み直す</Button> : null}
          </div>
        ) : null}

        {phase === 'operation' ? (
          <div className={styles.body}>
            <div className={styles.selectionBanner}>
              <strong>選択した友だち {formatNumber(friendIds.length)}人</strong>
              <span title={selectedFriends.map((friend) => friend.displayName).join('・')}>{selectedFriends.map((friend) => friend.displayName).join('・')}</span>
              <Button onClick={close}>選び直す</Button>
            </div>
            {groups.map((group) => (
              <fieldset key={group.label} className={styles.operationPanel}>
                <legend className={styles.panelTitle}>{group.label}</legend>
                <div className={styles.ops}>
                  {group.operations.filter((op) => op.kind !== 'set_support' || supportMarksEnabled).map((op) => (
                    <button key={op.kind} type="button" aria-pressed={operationKind === op.kind} disabled={previewState === 'loading'}
                      onClick={() => {
                        setOperationKind(op.kind); setInput(EMPTY_BULK_INPUT)
                        setPreview(null); setFailure(null); setPreviewState('idle'); setIrreversibleConfirmed(false)
                      }} className={operationKind === op.kind ? styles.opOn : styles.op}>
                      <span className={styles.opLabel}><op.Icon aria-hidden="true" size={16} />{op.label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className={styles.field}>
              <h3 className={styles.panelTitle}>実行内容</h3>
              <BulkOperationEditor kind={operationKind} accountId={accountId} tags={tags} input={input} onChange={setInput} disabled={previewState === 'loading'} />
            </div>
            {previewState === 'loading' ? <ListState kind="loading" title="対象を数えています" /> : null}
            {previewState === 'error' ? (
              <ListState
                kind="error"
                title="対象を数えられませんでした"
                description="選んだ友だちは変わっていません。読み直してから、もう一度お試しください。"
                onRetry={() => void loadPreview()}
              />
            ) : null}
            {previewState === 'forbidden' ? (
              <ListState
                kind="forbidden"
                title="まとめて操作する権限がありません"
                description="この操作はオーナーと管理者だけが行えます。"
              />
            ) : null}

          </div>
        ) : null}

        {phase === 'confirm' && preview ? (
          <div className={styles.body}>
            <div className={styles.notice}>
              <OperationIcon aria-hidden="true" size={18} />
              <div className="min-w-0"><h3 className={styles.blockTitle}>{selectedOperation?.label ?? '一括操作'}</h3>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink-secondary">{operationSummary}</p>
              {reversible ? <p className={styles.hint}>あとから「取り消し」で元に戻せます</p> : null}</div>
            </div>
            <dl className={styles.summary}>
              <div><dt>選んだ人</dt><dd>{countText(preview.selectedCount, '人')}</dd></div>
              <div><dt>実際の対象</dt><dd className={styles.strong}>{countText(preview.targetCount, '人')}</dd></div>
              <div><dt>対象外</dt><dd>{countText(preview.excludedCount, '人')}</dd></div>
            </dl>

            {preview.accountBreakdown.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>LINEアカウント別</h3>
                <ul className={styles.list}>
                  {preview.accountBreakdown.map((row) => (
                    <li key={row.lineAccountId ?? 'none'}>
                      {row.lineAccountId ? 'このアカウント' : 'アカウント未設定'}
                      <span className={styles.count}>{countText(row.count, '人')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.exclusions.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>対象外の理由</h3>
                <ul className={styles.list}>
                  {preview.exclusions.map((row) => (
                    <li key={row.reason}>{row.reason}<span className={styles.count}>{countText(row.count, '人')}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.sample.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>選択した友だち</h3>
                <table className="w-full table-fixed text-xs">
                  <colgroup><col className="w-1/4" /><col className="w-1/5" /><col className="w-1/5" /><col /></colgroup>
                  <thead><TableHeadRow><Th>名前</Th><Th>流入元</Th><Th>担当者</Th><Th>現在のタグ</Th></TableHeadRow></thead>
                  <tbody>
                    {preview.sample.map((item) => {
                      const friend = selectedFriends.find((selected) => selected.id === item.friendId)
                      const name = item.displayName ?? '名前未登録'
                      const source = friend ? friend.firstTrackedLinkName || '不明' : '—'
                      const operator = friend ? friend.operator?.name ?? '未割り当て' : '—'
                      const tagNames = friend ? friend.tags.map((tag) => tag.name).join('・') || '—' : '—'
                      return <tr key={item.friendId}>
                        <Td><span className="block truncate" title={name}>{name}</span></Td>
                        <Td><span className="block truncate" title={source}>{source}</span></Td>
                        <Td><span className="block truncate" title={operator}>{operator}</span></Td>
                        <Td><span className="block truncate" title={tagNames}>{tagNames}</span></Td>
                      </tr>
                    })}
                  </tbody>
                </table>
              </section>
            ) : null}

            {!reversible ? (
              <Checkbox checked={irreversibleConfirmed} onCheckedChange={setIrreversibleConfirmed}>
                {/* 取り消せないことを窓の中に書く。 */}
                この操作は取り消せません。{countText(preview.targetCount, '人')}に実行することを確認しました。
              </Checkbox>
            ) : null}

            {blocked ? <p className={styles.hint}>{blocked}</p> : null}

          </div>
        ) : null}

        {phase === 'result' ? (
          <div className={styles.body}>
            {resultState === 'loading' && !detail ? (
              <ListState kind="loading" title={`${resultTitle}の結果を確認しています`} />
            ) : null}

            {detail ? (
              <>
                <dl className={styles.summary}>
                  {ITEM_GROUPS.map((group) => {
                    const value = group.key === 'success' ? detail.successCount
                      : group.key === 'skipped' ? detail.skippedCount
                        : group.key === 'temporary_failure' ? detail.temporaryFailureCount
                          : detail.permanentFailureCount
                    return (
                      <div key={group.key}>
                        <dt className="flex items-center gap-1">{group.label}{group.key === 'success' || group.key === 'skipped' ? <HelpTip label={`${group.label}の説明`}>{group.note}</HelpTip> : null}</dt>
                        <dd>{countText(value, '人')}</dd>
                        {group.key === 'temporary_failure' || group.key === 'permanent_failure' ? <p className={styles.hint}>{group.note}</p> : null}
                      </div>
                    )
                  })}
                </dl>

                <p className={styles.note}>
                  {resultComplete
                    ? `${resultTitle}が終わりました。`
                    : `${resultTitle}を処理しています。終わるまでこの結果を更新します。`}
                </p>

                {detail.items.length > 0 ? (
                  <ul className={styles.list}>
                    {detail.items.map((item) => (
                      <li key={item.id}>
                        {item.displayName ?? '名前未登録'}
                        <span className={styles.count}>{itemStatusLabel(item.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
