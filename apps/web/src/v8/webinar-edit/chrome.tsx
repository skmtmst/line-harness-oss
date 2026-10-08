'use client'

/*
 * ウェビナーの編集（V8）の頭まわり。
 * - 詳細の頭（参加者 uNsEy・分析 z2dgw・コメント演出 Omqd4）：戻る → 題 → 説明の行、右に操作、下にタブ。
 * - 作る手順の帯（作る型 CreatePage の steps に渡す）：5段、済みの段へ戻れる（型の共通部品 Steps）。
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Steps } from '@/components/templates/steps'
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
          <BackLink />
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
 * 作る手順の帯。型の共通部品 Steps（Fa8ED）へ渡すだけ。済みの段は押して戻れる（まだの段は押せない・2026-10-08 オーナー）。
 */
export function WizardSteps({
  current,
  stateOf,
  onSelect,
}: {
  current: StepKey
  stateOf: (key: StepKey) => 'done' | 'current' | 'todo'
  /** 渡さないときは段を押せない（作る前など）。 */
  onSelect?: (key: StepKey) => void
}) {
  return (
    <Steps
      label="ウェビナーを作る進み方"
      currentKey={current}
      steps={STEPS.map((step) => {
        const state = stateOf(step.key)
        return {
          key: step.key,
          label: step.title,
          order: step.no,
          state: state === 'current' ? 'todo' : state,
          onSelect: onSelect ? () => onSelect(step.key) : undefined,
        }
      })}
    />
  )
}
