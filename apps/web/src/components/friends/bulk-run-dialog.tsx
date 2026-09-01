'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { ApiError, api } from '@/lib/api'
import type {
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunDetail,
  FriendBulkSelection,
} from '@line-crm/shared'
import {
  ITEM_GROUPS, OPERATIONS, blockedReason, canExecute, canRetry, canUndo, countText,
  failureOf, itemStatusLabel, newIdempotencyKey, operationLabel, type Failure,
} from './bulk-run-view'
import styles from './bulk-run-dialog.module.css'

type Phase = 'operation' | 'confirm' | 'result'

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

  /*
    **遅い返事を別の対象へ映さない。**
    アカウント・対象の組み合わせ・世代の3つが一致したときだけ受け取る。
  */
  const requestRef = useRef<{ accountId: string | null; targetKey: string; generation: number }>({
    accountId: null, targetKey: '', generation: 0,
  })

  const selection: FriendBulkSelection = { kind: 'explicit', friendIds }
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
      targetKey: friendIds.join(','),
      generation: requestRef.current.generation + 1,
    }
    const at = { ...requestRef.current }
    const stillHere = () =>
      requestRef.current.accountId === at.accountId
      && requestRef.current.targetKey === at.targetKey
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
  }, [accountId, friendIds, operation, selection])

  useEffect(() => {
    /* 閉じたら持ち越さない。次に開いたとき前の結果が残っていると取り違える。 */
    if (!open) {
      setPhase('operation'); setPreview(null); setDetail(null)
      setFailure(null); setIrreversibleConfirmed(false); setPreviewState('idle')
      requestRef.current = { ...requestRef.current, generation: requestRef.current.generation + 1 }
    }
  }, [open])

  if (!open) return null

  const execute = async () => {
    const op = operation()
    if (!op) return
    setBusy(true)
    setFailure(null)
    try {
      /* **操作ごとに新しい鍵。** 使い回すと別の内容を同じ鍵で送って409になる。 */
      const key = newIdempotencyKey(`${operationKind}-${friendIds.length}-${Date.now()}`)
      const res = await api.friends.bulkCreate(selection, op, {
        idempotencyKey: key,
        ...(reversible ? {} : { confirmIrreversible: true }),
      })
      if (!res.success) throw new Error('failed')
      const got = await api.friends.bulkGet(res.data.id)
      if (got.success) setDetail(got.data)
      setPhase('result')
      onDone()
    } catch (err) {
      setFailure(failureOf({ status: err instanceof ApiError ? err.status : undefined }))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!detail) return
    setBusy(true); setFailure(null)
    try {
      /* **やり直すのは失敗した対象だけ。** 成功済みには触らない。 */
      const res = await api.friends.bulkRetry(detail.id)
      if (!res.success) throw new Error('failed')
      const got = await api.friends.bulkGet(detail.id)
      if (got.success) setDetail(got.data)
    } catch (err) {
      setFailure(failureOf({ status: err instanceof ApiError ? err.status : undefined }))
    } finally { setBusy(false) }
  }

  const undo = async () => {
    if (!detail) return
    setBusy(true); setFailure(null)
    try {
      const res = await api.friends.bulkUndo(detail.id, newIdempotencyKey(`undo-${detail.id}-${Date.now()}`))
      if (!res.success) throw new Error('failed')
      const got = await api.friends.bulkGet(detail.id)
      if (got.success) setDetail(got.data)
      onDone()
    } catch (err) {
      setFailure(failureOf({ status: err instanceof ApiError ? err.status : undefined }))
    } finally { setBusy(false) }
  }

  const blocked = blockedReason({ preview, reversible, irreversibleConfirmed })

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
            {failure.canReload ? <Button onClick={() => void loadPreview()}>読み直す</Button> : null}
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
                action={<Button onClick={() => void loadPreview()}>数え直す</Button>}
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
              <Button onClick={onClose}>キャンセル</Button>
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

        {phase === 'result' && detail ? (
          <div className={styles.body}>
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

            <p className={styles.note}>{operationLabel(detail.operation.kind)}を実行しました。</p>

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

            <div className={styles.actions}>
              <Button onClick={onClose} disabled={busy}>閉じる</Button>
              {canUndo(detail) ? (
                <Button onClick={() => void undo()} disabled={busy}>取り消す</Button>
              ) : null}
              {canRetry(detail) ? (
                <Button variant="primary" onClick={() => void retry()} disabled={busy}>
                  失敗した{countText(detail.temporaryFailureCount, '人')}だけやり直す
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
