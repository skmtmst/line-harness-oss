'use client'
import { CheckCheck, CreditCard, MessageCircle, X } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import { RowMenu } from '@/components/shared/row-actions'
import StatusBadge from '@/components/shared/status-badge'
import type { StyleRoster } from '@/lib/api-style-dashboard'
import styles from './style-dashboard.module.css'

/*
 * 教室の「名簿のパネル」（k2MBw）。一覧で回を押すと右に開く。
 * 出席の印・この回の人に LINE・支払いのリンク（Stripe をつなぐまで押せない）・休講にする。
 */
export function LessonRoster({ roster, canWrite, onClose, onPay, onAttend, onLine, onCancelClass }: {
  roster: StyleRoster
  canWrite: boolean
  onClose: () => void
  onPay: () => void
  onAttend: (name: string | null) => void
  onLine: () => void
  onCancelClass: () => void
}) {
  return (
    <section className={styles.roster} aria-label={`${roster.title}の名簿`}>
      <div className={styles.rosterHead}>
        <div className={styles.rosterTitle}>
          <span className={styles.cellSub}>{roster.head}</span>
          <h3>{roster.title}</h3>
        </div>
        <IconButton aria-label="名簿を閉じる" onClick={onClose}><X size={16} /></IconButton>
      </div>
      <div className={styles.rosterMeta}><StatusBadge tone={roster.pay.tone}>{roster.pay.label}</StatusBadge><span className={styles.cellMuted}>{roster.meta}</span></div>
      {canWrite ? (
        <div className={styles.rosterTools}>
          <Button size="compact" onClick={() => onAttend(null)}><CheckCheck size={16} aria-hidden="true" />全員出席</Button>
          <Button size="compact" onClick={onLine}><MessageCircle size={16} aria-hidden="true" />この回の人に LINE</Button>
          <span className={styles.grow} />
          <RowMenu appearance="box" size="row" label="この回の操作" items={[{ id: 'line', label: 'この回の人に LINE を送る', onSelect: onLine }, { id: 'cancel', label: '休講にする', tone: 'danger', onSelect: onCancelClass }]} />
        </div>
      ) : null}
      <div className={styles.rosterList}>
        {roster.members.map((m) => (
          <div key={m.name} className={styles.rosterRow}>
            <span className={styles.rosterName}><strong>{m.name}</strong><span className={styles.cellSub}>{m.sub}</span></span>
            <span className={styles.grow} />
            <StatusBadge tone={m.pay.tone}>{m.pay.label}</StatusBadge>
            <span className={styles.rosterAttend}>
              {m.attend === 'done' ? <span className={styles.attendDone}>✓ 出席</span> : m.attend === 'cancel' ? <span className={styles.cellMuted}>取消</span> : canWrite ? <Button size="compact" onClick={() => onAttend(m.name)}>出席</Button> : <span className={styles.cellMuted}>—</span>}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.cellMuted}>{roster.more}</p>
      {canWrite ? (
        <div className={styles.rosterFoot}>
          <Button onClick={onPay}><CreditCard size={16} aria-hidden="true" />支払いのリンクを送る（{roster.payLinkCount}人）</Button>
          <span className={styles.grow} />
          <Button variant="text" textTone="danger" onClick={onCancelClass}>休講にする</Button>
        </div>
      ) : null}
    </section>
  )
}
