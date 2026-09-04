'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { ApiError, api } from '@/lib/api'
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
  tags,
  accountId,
  onClose,
  onDone,
}: {
  open: boolean
  friendIds: string[]
  tags: Array<{ id: string; name: string }>
  accountId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('operation')
  const [operationKind, setOperationKind] = useState<FriendBulkOperation['kind']>('add_tag')
  const [tagId, setTagId] = useState('')
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

  const operation = useCallback((): FriendBulkOperation | null => {
    if (operationKind === 'add_tag' || operationKind === 'remove_tag') {
      return tagId ? { kind: operationKind, tagId } : null
    }
    return null
  }, [operationKind, tagId])

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

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="友だちを一括操作">
      <div className={styles.panel} data-design-node="IAf7j">
        <header className={styles.head}>
          <h2 className={styles.title}>友だちを一括操作</h2>
          <p className={styles.note}>{friendIds.length.toLocaleString('ja-JP')}人を選択中。対象を確認してから操作を選んでください。</p>
        </header>

        {failure ? (
          <div className={failure.kind === 'forbidden' ? styles.notice : styles.warn} role="alert" data-failure-kind={failure.kind}>
            <p>{failure.message}</p>
            {failure.canReload ? <Button onClick={reloadFailure}>読み直す</Button> : null}
          </div>
        ) : null}

        {phase === 'operation' ? (
          <div className={styles.body}>
            <fieldset className={styles.field}>
              <legend className={styles.label}>実行する操作を選択</legend>
              <div className={styles.ops}>
                {OPERATIONS.filter((o) => o.kind === 'add_tag' || o.kind === 'remove_tag').map((op) => (
                  <button
                    key={op.kind}
                    type="button"
                    role="radio"
                    aria-checked={operationKind === op.kind}
                    onClick={() => setOperationKind(op.kind)}
                    className={operationKind === op.kind ? styles.opOn : styles.op}
                  >
                    <span className={styles.opLabel}>{op.label}</span>
                    <span className={styles.opNote}>{op.note}</span>
                  </button>
                ))}
              </div>
              {/* いま画面で組み立てられるのはタグの付け外しだけ。ほかは口の形が要る。 */}
              <p className={styles.hint}>ほかの操作は準備中です。</p>
            </fieldset>

            <label className={styles.field}>
              <span className={styles.label}>どのタグ</span>
              <select aria-label="どのタグ" className={styles.input} value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">選んでください</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>

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

            <div className={styles.actions}>
              <Button onClick={close}>キャンセル</Button>
              <Button variant="primary" disabled={!tagId || previewState === 'loading'} onClick={() => void loadPreview()}>
                実行内容を確認
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'confirm' && preview ? (
          <div className={styles.body}>
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
                <ul className={styles.list}>
                  {preview.sample.map((item) => (
                    /* 内部IDは出さない。名前が無いときは「名前未登録」。 */
                    <li key={item.friendId}>{item.displayName ?? '名前未登録'}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!reversible ? (
              <label className={styles.confirm}>
                <input type="checkbox" checked={irreversibleConfirmed} onChange={(e) => setIrreversibleConfirmed(e.target.checked)} />
                {/* 取り消せないことを窓の中に書く。 */}
                この操作は取り消せません。{countText(preview.targetCount, '人')}に実行することを確認しました。
              </label>
            ) : null}

            {blocked ? <p className={styles.hint}>{blocked}</p> : null}

            <div className={styles.actions}>
              <Button onClick={() => setPhase('operation')} disabled={busy}>戻る</Button>
              <Button
                variant="primary"
                disabled={!canExecute({ preview, busy, irreversibleConfirmed, reversible })}
                onClick={() => void execute()}
              >
                {busy ? '実行中…' : `${countText(preview.targetCount, '人')}に実行`}
              </Button>
            </div>
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
                        <dt>{group.label}</dt>
                        <dd>{countText(value, '人')}</dd>
                        <p className={styles.hint}>{group.note}</p>
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

            <div className={styles.actions}>
              <Button onClick={close} disabled={busy}>閉じる</Button>
              {resultState === 'ready' && canUndo(detail) ? (
                <Button onClick={() => void undo()} disabled={busy}>取り消す</Button>
              ) : null}
              {resultState === 'ready' && canRetry(detail) ? (
                <Button variant="primary" onClick={() => void retry()} disabled={busy}>
                  失敗した{countText(detail?.temporaryFailureCount, '人')}だけやり直す
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
