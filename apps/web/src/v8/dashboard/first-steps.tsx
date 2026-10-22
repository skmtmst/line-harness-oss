'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/shared/list-navigation'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { canManageRole } from '@/lib/staff-role'
import styles from './first-steps.module.css'
import { ProgressBar } from '@/components/shared/progress'

import { useFirstRun } from '@/v8/onboarding/public/use-first-run/index'
import { doneCount, type StepResult } from '@/v8/settings/public/getting-started-steps/index'

export type FirstStepsSummary = {
  steps: Array<{ key: string; label: string; href: string | null; link: string; done: boolean; state: StepResult['state'] }>
  done: number
  total: number
}

/** 設定画面と同じ状態・権限・行き先を使い、別の完了条件を持たない。 */
export function summarizeFirstSteps(steps: ReadonlyArray<StepResult>): FirstStepsSummary {
  return { steps: steps.map((step) => ({ key: step.key, label: step.title, href: step.action?.href ?? null, link: step.action ? (step.key === 'firstMessage' ? '確かめる →' : '開く →') : step.blockedReason ?? '状態を確認する', done: step.state === 'done', state: step.state })), done: doneCount(steps), total: steps.length }
}

export function shouldShowFirstSteps(role: string | null, summary: FirstStepsSummary | null): boolean {
  return canManageRole(role) && summary !== null && summary.done < summary.total
}

export function firstStepsStorageKey(accountId: string): string {
  return `lh:v8:first-steps-folded:${accountId}`
}

/** 前の「閉じる」の印。押した人は畳んだ形で出す。 */
export function firstStepsLegacyDismissedKey(accountId: string): string {
  return `lh:v8:first-steps-dismissed:${accountId}`
}

/** 畳んでいるか。'1' 畳む・'0' 開く。印が無ければ前の「閉じる」を見る。 */
export function readFirstStepsFolded(accountId: string | null): boolean {
  if (!accountId || typeof window === 'undefined') return false
  try {
    const saved = window.localStorage.getItem(firstStepsStorageKey(accountId))
    if (saved === '1' || saved === '0') return saved === '1'
    return window.localStorage.getItem(firstStepsLegacyDismissedKey(accountId)) === '1'
  } catch { return false }
}

export function useFirstSteps(accountId: string | null, role: string | null) {
  const enabled = Boolean(accountId) && canManageRole(role)
  const state = useFirstRun(accountId, enabled)
  const summary = state.status === 'ready' ? summarizeFirstSteps(state.steps) : null
  const [folded, setFolded] = useState(false)
  useEffect(() => { setFolded(readFirstStepsFolded(accountId)) }, [accountId])
  const toggle = useCallback(() => {
    setFolded((current) => {
      const next = !current
      if (accountId) {
        try { window.localStorage.setItem(firstStepsStorageKey(accountId), next ? '1' : '0') } catch { /* 覚えられなくても今は畳む・開く */ }
      }
      return next
    })
  }, [accountId])
  return { summary: shouldShowFirstSteps(role, summary) ? summary : null, folded, toggle, error: state.error, reload: state.reload }
}

export function FirstStepsCard({ summary, folded, onToggle }: { summary: FirstStepsSummary; folded: boolean; onToggle: () => void }) {
  return (
    <section className={styles.card} aria-labelledby="first-steps-title" data-design-node="r3X34">
      <div className={styles.head}>
        <h2 id="first-steps-title" className={styles.title}>はじめにやること</h2>
        <span className={styles.count}>{`${summary.done} / ${summary.total} 済み`}</span>
        <ProgressBar appearance="onboarding" value={summary.done} max={summary.total} label="はじめにやることの進み" />
        <span className={styles.spacer} />
        <button type="button" className={styles.fold} onClick={onToggle} aria-expanded={!folded} aria-controls="first-steps-list">
          {folded ? '開く' : '畳む'}
          {folded ? <ChevronDown className={styles.foldIcon} aria-hidden="true" /> : <ChevronUp className={styles.foldIcon} aria-hidden="true" />}
        </button>
      </div>
      <ul id="first-steps-list" className={styles.grid} hidden={folded}>
        {summary.steps.map((step) => (
          <li key={step.key} className={styles.step} data-done={step.done ? '' : undefined}>
            <span className={styles.check} aria-hidden="true">{step.done ? <Check className={styles.checkIcon} strokeWidth={3} /> : null}</span>
            <span className={styles.label} title={step.label}>
              {step.label}
              <span className="sr-only">{step.done ? '（済み）' : step.state === 'unknown' ? '（未確認）' : step.state === 'forbidden' ? '（権限がありません）' : '（まだ）'}</span>
            </span>
            {!step.done && !step.href ? <span className={styles.count}>{step.state === 'unknown' ? '未確認' : '権限がありません'}</span> : step.done ? null : (
              <>
                <span className={styles.spacer} />
                <Link href={step.href!} className={styles.link} aria-label={`${step.label}（${step.link.replace(' →', '')}）`}>{step.link}</Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
