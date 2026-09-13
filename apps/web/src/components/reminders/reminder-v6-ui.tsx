'use client'

import type { ReactNode } from 'react'
import Button, { type ButtonProps } from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import styles from './reminder-v6-ui.module.css'

const STEPS = ['基本設定', '対象者', '通知ステップ', '送信設定', '確認']

export function ReminderWizard({ current }: { current: number }) {
  return (
    <div className={styles.wizard} aria-label="リマインダ設定の手順">
      <a href="/reminders" className={styles.back}>リマインダ一覧</a>
      <ol className={styles.steps}>
        {STEPS.map((label, index) => {
          const number = index + 1
          const complete = number < current
          const active = number === current
          return (
            <li key={label} className={active ? styles.stepActive : complete ? styles.stepDone : styles.step} aria-current={active ? 'step' : undefined}>
              <span className={styles.stepDot}>{complete ? '✓' : number}</span>
              <span><small>STEP {number}</small>{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function ReminderWorkspace({ children, aside, fill = false }: { children: ReactNode; aside?: ReactNode; fill?: boolean }) {
  return <div className={`${aside ? styles.workspace : styles.workspaceWide} ${fill ? styles.workspaceFill : ''}`}><div className={styles.main}>{children}</div>{aside ? <aside className={styles.aside}>{aside}</aside> : null}</div>
}

export function ReminderPanel({ title, note, action, children, className = '' }: {
  title: string
  note?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <div className={styles.panelHead}>
        <div><h2>{title}</h2>{note ? <p>{note}</p> : null}</div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  )
}

export function SummaryCard({ rows, title = '設定内容' }: { title?: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section className={styles.summary}>
      <h2>{title}</h2>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  )
}

export function LinePreview({ caption, children, empty = false }: { caption: string; children: ReactNode; empty?: boolean }) {
  return (
    <section className={styles.linePreview}>
      <h2>LINEプレビュー</h2>
      <p className={styles.previewCaption}>{caption}</p>
      <div className={empty ? styles.previewEmpty : styles.bubble}>{children}</div>
    </section>
  )
}

export function ReminderFooter({ status = '下書き保存', secondary, primary, primaryDisabled = false, onPrimary }: {
  status?: string
  secondary?: { label: string; href?: string; onClick?: () => void }
  primary: string
  primaryDisabled?: boolean
  onPrimary?: () => void
}) {
  return (
    <StickyBar
      className={styles.footer}
      status={status}
      actions={<>
        {secondary ? secondary.href ? <a className={styles.footerSecondary} href={secondary.href}>{secondary.label}</a> : <button className={styles.footerSecondary} type="button" onClick={secondary.onClick}>{secondary.label}</button> : null}
        <button className={styles.footerPrimary} type="button" disabled={primaryDisabled} onClick={onPrimary}>{primary}</button>
      </>}
    />
  )
}

export function Choice({ selected, title, note, onClick }: { selected: boolean; title: string; note?: string; onClick: () => void }) {
  return <button type="button" className={selected ? styles.choiceActive : styles.choice} onClick={onClick}><span>{selected ? '●' : '○'}</span><strong>{title}</strong>{note ? <small>{note}</small> : null}</button>
}

export function ReminderButton(props: ButtonProps) {
  return <Button {...props} className={[styles.smallButton, props.className].filter(Boolean).join(' ')} />
}

export function ReminderStepCard({ selected, number, timing, title, note }: { selected: boolean; number: number; timing: string; title: string; note: string }) {
  return <button type="button" className={selected ? styles.stepCardActive : styles.stepCard}><span>{number}</span><strong>{timing}</strong><b>{title}</b><small>{note}</small></button>
}

export function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{note ? <small>{note}</small> : null}{children}</label>
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <StatusBadge tone={tone} size="compact" className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</StatusBadge>
}

export const reminderV6Styles = styles
