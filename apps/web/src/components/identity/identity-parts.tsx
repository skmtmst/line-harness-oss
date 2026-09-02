import React from 'react'
import type { ReactNode } from 'react'
import type {
  IdentityCandidateDetail,
  IdentityCandidateEvidence,
  IdentityCandidateHistoryItem,
  IdentityCandidateImpactMetric,
  IdentityCandidateSubject,
} from '@line-crm/shared'
import Card from '@/components/shared/card'
import {
  confidenceText,
  impactText,
  maskedText,
  NOT_AVAILABLE,
  reprocessText,
  statusText,
  strengthText,
  UNDO_NOTE,
} from './identity-view'
import styles from './identity-review.module.css'

/**
 * 本人照合の候補を読むための共通部品。
 *
 * 設計 `InCDe`（友だち同士）と `ELayY`（ECの会員）は外枠が違うだけで、
 * **中で人が判断に使うもの**——2件の中身・根拠の強さ・確信度・
 * 結び付けたときの影響・これまでの判断——は同じ。片方だけ直った状態を
 * 作らないために、ここに1組だけ置く。
 */

/** 「元の記録を消さない」ことを、押す前に言う帯。 */
export function IdentityAssurance({ children }: { children: ReactNode }) {
  return (
    <div className={styles.assurance} data-identity-part="assurance">
      <p className={styles.assuranceTitle}>
        結び付けても、元の友だち・注文・LINEアカウントは消えません。
      </p>
      <p className={styles.assuranceBody}>{children}</p>
      <p className={styles.assuranceBody}>{UNDO_NOTE}</p>
    </div>
  )
}

/** 確からしさの札。数字だけだと高い低いが伝わらないので、言葉を主にする。 */
export function ConfidenceTag({ confidence }: { confidence: IdentityCandidateDetail['confidence'] }) {
  const strong = confidence.label === 'very_high' || confidence.label === 'high'
  return (
    <span
      className={`${styles.tag} ${strong ? styles.tagStrong : styles.tagWarn}`}
      data-identity-confidence={confidence.label}
    >
      確からしさ {confidenceText(confidence.label)}
    </span>
  )
}

export function StatusTag({ status }: { status: IdentityCandidateDetail['status'] }) {
  return (
    <span
      className={`${styles.tag} ${status === 'pending' ? styles.tagWarn : styles.tagWeak}`}
      data-identity-status={status}
    >
      {statusText(status)}
    </span>
  )
}

/**
 * 候補1件。
 *
 * `attributes` はマスク済みの値しか来ない契約なので、そのまま出す。
 * 取得できていない項目は「—（未取得）」。空欄にすると「登録が無い」のか
 * 「読めていない」のか分からない。
 */
export function IdentitySubjectCard({
  side,
  subject,
}: {
  /** 「候補A」「ECの注文・会員」など、どちら側かを言う短い見出し。 */
  side: string
  subject: IdentityCandidateSubject
}) {
  return (
    <Card layout="vertical" className={styles.subject} data-identity-part="subject">
      <p className={styles.subjectSide}>{side}</p>
      <p className={styles.subjectLabel}>{subject.label}</p>
      <p className={styles.subjectDetail}>
        {subject.detail ?? NOT_AVAILABLE}
        {subject.lineAccountName ? `／${subject.lineAccountName}` : ''}
      </p>
      <div className={styles.attributes}>
        {subject.attributes.map((attribute) => (
          <div key={attribute.label} className={styles.attribute}>
            <span className={styles.attributeLabel}>{attribute.label}</span>
            <span className={styles.attributeValue}>{maskedText(attribute.valuePreview)}</span>
            <span className={`${styles.tag} ${attribute.verified ? styles.tagStrong : styles.tagWeak}`}>
              {attribute.verified ? '確認済み' : '未確認'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** 判定根拠。強さを出さないと、参考どまりの一致が決め手に見える。 */
export function IdentityEvidenceList({
  evidence,
  confidence,
}: {
  evidence: IdentityCandidateEvidence[]
  confidence: IdentityCandidateDetail['confidence']
}) {
  return (
    <Card layout="vertical" className={styles.section} data-identity-part="evidence">
      <p className={styles.sectionTitle}>判定根拠</p>
      <ConfidenceTag confidence={confidence} />
      <div className={styles.rows}>
        {evidence.map((item) => (
          <div key={item.key} className={styles.evidenceItem}>
            <p className={styles.evidenceHead}>
              {item.label}
              <span
                className={`${styles.tag} ${item.strength === 'strong' ? styles.tagStrong : styles.tagWeak}`}
              >
                {strengthText(item.strength)}
              </span>
              <span className={`${styles.tag} ${item.verified ? styles.tagStrong : styles.tagWeak}`}>
                {item.verified ? '確認済み' : '未確認'}
              </span>
            </p>
            <p className={styles.evidenceNote}>{maskedText(item.valuePreview)}</p>
          </div>
        ))}
      </div>
      <p className={styles.evidenceNote}>
        表示名やプロフィール画像だけの一致は、決め手にはしません。
      </p>
    </Card>
  )
}

/**
 * 結び付けたときの影響。
 *
 * `value === null` は取得元がまだ繋がっていないという意味で、0 とは違う。
 * 同じ見た目で出すと、結び付けても何も起きないように読める。
 */
export function IdentityImpactList({ impact }: { impact: IdentityCandidateImpactMetric[] }) {
  return (
    <Card layout="vertical" className={styles.section} data-identity-part="impact">
      <p className={styles.sectionTitle}>結び付けた場合の影響</p>
      <div className={styles.rows}>
        {impact.map((metric) => (
          <div key={metric.key} className={styles.row}>
            <span className={styles.rowLabel}>
              {metric.label}
              {metric.note ? `（${metric.note}）` : ''}
            </span>
            <span
              className={`${styles.rowValue} ${metric.value === null ? styles.rowValuePending : ''}`}
              data-identity-impact={metric.key}
            >
              {impactText(metric)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** これまでの判断。取り消しても履歴は残る、という約束の裏付け。 */
export function IdentityHistoryList({ history }: { history: IdentityCandidateHistoryItem[] }) {
  return (
    <Card layout="vertical" className={styles.section} data-identity-part="history">
      <p className={styles.sectionTitle}>判断の履歴</p>
      {history.length === 0 ? (
        <p className={styles.evidenceNote}>まだ判断していません。</p>
      ) : (
        <div className={styles.history}>
          {history.map((item) => (
            <div key={item.id} className={styles.historyItem}>
              <p className={styles.historyHead}>
                {statusText(item.fromStatus)} → {statusText(item.toStatus)}
              </p>
              <p className={styles.historyMeta}>
                {item.actorName}／{item.decidedAt.slice(0, 10)}
                {item.reprocessMode ? `／${reprocessText(item.reprocessMode)}` : ''}
              </p>
              <p className={styles.historyMeta}>{item.reason}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
