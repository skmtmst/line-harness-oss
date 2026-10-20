'use client'

/*
 * ★V8 LINEアカウントの詳細（Pencil ）。
 *
 * 白い板の頭（題・状態の1行・右に「編集する」「乗り換え」）→ 左に「設定の中のメニュー」→
 * 中央に登録の内容・つづき・資格情報・Webhook、右にできること・気をつけること・つながる先・
 * 送受信を止める／アーカイブ。窓（止める ・資格情報 ・アーカイブ ・
 * 編集 ）は dialogs.tsx。データの口は今の画面（app/accounts/detail）と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { type ReactNode } from 'react';
import styles from './detail.module.css';


/** 札（幅150）と値の1行。上に線。 */
function Row({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className={styles.row} id={id}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  )
}


/** つづきの段の1行。札と値を半分ずつ。下に線。 */
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.pair}>
      <span className={styles.pairLabel}>{label}</span>
      <span className={styles.pairValue}>{children}</span>
    </div>
  )
}


/** 値と、右端の操作。 */
function ActionValue({ value, action }: { value: string; action: ReactNode }) {
  return (
    <span className={styles.actionValue}>
      <span className={styles.muted} title={value}>{value}</span>
      <span className={styles.spacer} />
      {action}
    </span>
  )
}
export { Row, Pair, ActionValue }
