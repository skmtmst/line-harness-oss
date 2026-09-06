'use client'

import React, { useEffect, useState } from 'react'
import type {
  IdentityCandidateDecision,
  IdentityCandidateDetail,
  DecideIdentityCandidateRequest,
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
import type { IdentityCandidateWithProfiles } from '@/lib/api'

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
  candidate: IdentityCandidateDetail | IdentityCandidateWithProfiles
  busy: boolean
  /** 版競合や権限不足の言い換え。候補の中身は入れない。 */
  error?: string
  onCancel: () => void
  onSubmit: (input: {
    decision: IdentityCandidateDecision
    reason: string
    reprocess?: { mode: IdentityReprocessMode; from: null; to: null }
    profileSelections?: DecideIdentityCandidateRequest['profileSelections']
  }) => void
}) {
  const [decision, setDecision] = useState<IdentityCandidateDecision>('linked')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<IdentityReprocessMode>('future_only')
  const [profileSelections, setProfileSelections] = useState<Record<string, string>>({})
  const [consents, setConsents] = useState([false, false, false])

  // 別の候補を開いたら、前の候補の入力を持ち越さない。
  useEffect(() => {
    if (!open) return
    setDecision('linked')
    setReason('')
    setMode('future_only')
    const profiles = 'profileCandidates' in candidate ? candidate.profileCandidates : []
    setProfileSelections(Object.fromEntries(profiles.flatMap((field) => field.options[0] ? [[field.fieldKey, field.options[0].sourceFriendId]] : [])))
    setConsents([false, false, false])
  }, [open, candidate.id])

  const ec = candidate.kind === 'ec_member'
  const canReprocess = ec && decision === 'linked'
  const profileCandidates = 'profileCandidates' in candidate ? candidate.profileCandidates : []
  const linkedReady = decision !== 'linked' || ec || (
    profileCandidates.every((field) => Boolean(profileSelections[field.fieldKey]))
    && consents.every(Boolean)
  )
  const ready = canSubmitDecision({ canDecide: candidate.canDecide, reason, busy }) && linkedReady

  const submit = () =>
    onSubmit({
      decision,
      reason: reason.trim(),
      ...(canReprocess ? { reprocess: { mode, from: null, to: null } } : {}),
      ...(!ec && decision === 'linked' ? {
        profileSelections: profileCandidates.map((field) => ({
          fieldKey: field.fieldKey,
          sourceFriendId: profileSelections[field.fieldKey],
          updateMode: 'fixed' as const,
        })),
      } : {}),
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

        {!ec && decision === 'linked' && profileCandidates.length > 0 ? (
          <div className={styles.field}>
            <p className={styles.fieldLabel}>統合プロフィールに採用する値</p>
            {profileCandidates.map((field) => (
              <label key={field.fieldKey} className={styles.fieldLabel}>
                {field.fieldLabel}
                <select
                  className={styles.reason}
                  value={profileSelections[field.fieldKey] ?? ''}
                  onChange={(event) => setProfileSelections((current) => ({ ...current, [field.fieldKey]: event.target.value }))}
                >
                  {field.options.map((option) => (
                    <option key={option.sourceFriendId} value={option.sourceFriendId}>
                      {option.sourceLabel}：{option.valuePreview ?? '未登録'}{option.verified ? '（確認済み）' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        {!ec && decision === 'linked' ? (
          <div className={styles.field}>
            <p className={styles.fieldLabel}>利用目的と同意・規約の確認</p>
            {[
              'この統合の利用目的が、友だちが同意した範囲におさまっている',
              'プライバシーポリシーと利用規約に、この使い方が書いてある',
              'LINEの規約と、プロバイダーの決めごとに反していない',
            ].map((label, index) => (
              <label key={label} className={styles.choice}>
                <input
                  type="checkbox"
                  checked={consents[index]}
                  onChange={(event) => setConsents((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))}
                />
                <span className={styles.choiceNote}>{label}</span>
              </label>
            ))}
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
              ? decision === 'linked' && !linkedReady
                ? '理由を書くと判定できます。統合する場合は、採用する値と3つの確認もそろえてください。'
                : '理由を書くと判定できます。'
              : 'この候補はすでに判定されています。読み直してください。'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
