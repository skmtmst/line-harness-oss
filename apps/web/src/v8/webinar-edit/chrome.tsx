'use client'

/*
 * ウェビナーの編集（V8）の頭まわり。
 * - 詳細の頭（参加者 uNsEy・分析 z2dgw・コメント演出 Omqd4）：戻る → 題 → 説明の行、右に操作、下にタブ。
 * - 作る手順の帯（作る型 CreatePage の steps に渡す）：5段、どの段へも戻れる。
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { STEPS, type PaneKey, type StepKey } from './helpers'
import styles from './chrome.module.css'

export function BackLink() {
  return (
    <Link href="/webinars" className={styles.back}>← ウェビナーへ</Link>
  )
}

const DETAIL_TABS: ReadonlyArray<{ key: PaneKey; label: string }> = [
  { key: 'basic', label: '設定' },
  { key: 'participants', label: '参加者' },
  { key: 'analytics', label: '分析' },
  { key: 'comments', label: 'コメント演出' },
]

export function DetailHead({
  title,
  subtitle,
  actions,
  current,
  participantsCount,
  onSelect,
}: {
  title: string
  subtitle: string
  actions?: ReactNode
  current: PaneKey
  participantsCount: number | null
  onSelect: (key: PaneKey) => void
}) {
  return (
    <>
      <header className={styles.head} data-template-region="heading">
        <div className={styles.headText}>
          <h2 className={styles.title} title={title}>{title}</h2>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        {actions ? <div className={styles.headActions}>{actions}</div> : null}
      </header>
      <div className={styles.tabsRow}>
        <nav className={styles.tabs} aria-label="設定・参加者・分析・コメント演出" data-wc-tabs="true">
          {DETAIL_TABS.map((tab) => {
            const selected = tab.key === current
            const label = tab.key === 'participants' && participantsCount !== null ? `${tab.label} ${participantsCount}` : tab.label
            return (
              <button
                key={tab.key}
                type="button"
                className={styles.tab}
                aria-current={selected ? 'page' : undefined}
                data-selected={selected || undefined}
                onClick={() => { if (!selected) onSelect(tab.key) }}
              >
                {label}
              </button>
            )
          })}
        </nav>
      </div>
    </>
  )
}

/**
 * 作る手順の帯。共通の Stepper と同じ形（data-part="stepper"・li > button > 丸＋字）で書き、
 * 型の寸法（--tpl-steps-*）をそのまま効かせる。編集画面はどの段へも戻れるので、全部ボタンにする。
 */
export function WizardSteps({
  current,
  stateOf,
  onSelect,
}: {
  current: StepKey
  stateOf: (key: StepKey) => 'done' | 'current' | 'todo'
  /** 渡さないときは段を押せない（作る前など）。押せない形のボタンは置かず、文字だけにする。 */
  onSelect?: (key: StepKey) => void
}) {
  return (
    <nav aria-label="ウェビナーを作る進み方" data-part="stepper" className={styles.stepper}>
      <ol className={styles.stepList}>
        {STEPS.map((step, index) => {
          const state = stateOf(step.key)
          const previousDone = index > 0 && stateOf(STEPS[index - 1].key) === 'done'
          return (
            <li key={step.key} className={styles.stepItem}>
              {index > 0 ? <span aria-hidden className={styles.stepLine} data-done={previousDone || undefined} /> : null}
              {onSelect && step.key !== current ? (
                <button type="button" className={styles.stepButton} data-state={state} onClick={() => onSelect(step.key)}>
                  <span className={styles.stepDot} data-state={state}>
                    {state === 'done' ? <Check size={12} strokeWidth={3} aria-label="済み" /> : step.no}
                  </span>
                  <span className={styles.stepLabel} data-state={state}>{step.title}</span>
                </button>
              ) : (
                <span className={styles.stepButton} aria-current={step.key === current ? 'step' : undefined} data-state={state}>
                  <span className={styles.stepDot} data-state={state}>
                    {state === 'done' ? <Check size={12} strokeWidth={3} aria-label="済み" /> : step.no}
                  </span>
                  <span className={styles.stepLabel} data-state={state}>{step.title}</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
