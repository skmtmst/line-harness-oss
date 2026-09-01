'use client'

import React, { useEffect, useState } from 'react'
import type {
  IdentityCandidateDecision,
  IdentityCandidateDetail,
  IdentityReprocessMode,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import {
  canSubmitDecision,
  decisionNote,
  decisionText,
  REPROCESS_MODES,
  reprocessText,
  UNDO_NOTE,
} from './identity-view'
import styles from './identity-review.module.css'

const DECISIONS: IdentityCandidateDecision[] = ['linked', 'different', 'deferred']

/**
 * 判定窓。設計 `InCDe` の下部3ボタンと `ELayY` の行の「決める」が、
 * どちらもここへ入る。
 *
 * **理由を必ず書かせる。** Worker が `reason` を必須にしているのもあるが、
 * それ以上に、履歴を後から読む人が「何を見て決めたか」を追えなくなる。
 *
 * **再処理はECの照合だけ。** 既定は「今後だけ」で、過去のLINE送信を
 * 勝手に再送しない。友だち同士の判定に再処理を送ると Worker が 422 を返す。
 */
export default function IdentityDecisionDialog({
  open,
  candidate,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean
  candidate: IdentityCandidateDetail
  busy: boolean
  /** 版競合や権限不足の言い換え。候補の中身は入れない。 */
  error?: string
  onCancel: () => void
  onSubmit: (input: {
    decision: IdentityCandidateDecision
    reason: string
    reprocess?: { mode: IdentityReprocessMode; from: null; to: null }
  }) => void
}) {
  const [decision, setDecision] = useState<IdentityCandidateDecision>('linked')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<IdentityReprocessMode>('future_only')

  // 別の候補を開いたら、前の候補の入力を持ち越さない。
  useEffect(() => {
    if (!open) return
    setDecision('linked')
    setReason('')
    setMode('future_only')
  }, [open, candidate.id])

  const ec = candidate.kind === 'ec_member'
  const canReprocess = ec && decision === 'linked'
  const ready = canSubmitDecision({ canDecide: candidate.canDecide, reason, busy })

  const submit = () =>
    onSubmit({
      decision,
      reason: reason.trim(),
      ...(canReprocess ? { reprocess: { mode, from: null, to: null } } : {}),
    })

  return (
    <Dialog
      open={open}
      title="この2件を判定する"
      description="判定すると履歴に残ります。元の友だち・注文は消えません。"
      busy={busy}
      error={error}
      onCancel={onCancel}
      designNode={candidate.kind === 'friend_duplicate' ? 'InCDe' : 'ELayY'}
      footer={
        <div className={styles.actions}>
          <Button type="button" onClick={onCancel} disabled={busy}>
            やめる
          </Button>
          {/* 理由が空のまま押せると、履歴に「なぜそう決めたか」が残らない。 */}
          <Button type="button" variant="primary" onClick={submit} disabled={!ready}>
            {busy ? '処理中…' : decisionText(decision)}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <div className={styles.choices} role="radiogroup" aria-label="判定">
          {DECISIONS.map((item) => (
            <label
              key={item}
              className={`${styles.choice} ${decision === item ? styles.choiceOn : ''}`}
            >
              <input
                type="radio"
                name="identity-decision"
                value={item}
                checked={decision === item}
                onChange={() => setDecision(item)}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceTitle}>{decisionText(item)}</span>
                <span className={styles.choiceNote}>{decisionNote(item)}</span>
              </span>
            </label>
          ))}
        </div>

        {canReprocess ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="identity-reprocess">
              過去の扱い
            </label>
            <select
              id="identity-reprocess"
              className={styles.reason}
              value={mode}
              onChange={(event) => setMode(event.target.value as IdentityReprocessMode)}
            >
              {REPROCESS_MODES.map((item) => (
                <option key={item} value={item}>
                  {reprocessText(item)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="identity-reason">
            判定の理由（必須）
          </label>
          <textarea
            id="identity-reason"
            className={styles.reason}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="何を見てそう判断したかを書いてください。"
          />
        </div>

        <p className={styles.confirmNote}>{UNDO_NOTE}</p>

        {ready ? null : (
          <p className={styles.confirmNote} role="status">
            {candidate.canDecide
              ? '理由を書くと判定できます。'
              : 'この候補はすでに判定されています。読み直してください。'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
