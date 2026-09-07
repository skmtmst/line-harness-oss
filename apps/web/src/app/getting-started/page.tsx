'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'
import {
  CARE_ITEMS,
  FEATURE_LINKS,
  STEP_STATE_LABEL,
  type StepResult,
  type StepState,
  buildStepsFromApi,
  progressHeadline,
  stoppedReasons,
} from './getting-started-view'
import styles from './getting-started.module.css'

/** 段の状態の見え方。**色だけに頼らず、必ず文字で言う。** */
const STATE_TONE: Record<StepState, 'success' | 'warning' | 'neutral' | 'danger'> = {
  done: 'success',
  stalled: 'warning',
  todo: 'neutral',
  forbidden: 'danger',
  unknown: 'neutral',
}

/** 設計 ★V6 34-1（`RAW35`）。順路 4 段と最終確認。 */
export default function GettingStartedPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (accountLoading) return
    const accountId = selectedAccountId
    let alive = true
    setStatus('loading')

    void api.gettingStarted.get(accountId ?? undefined).then((res) => {
      if (!alive) return
      if (!res.success) {
        setStatus('error')
        return
      }
      setSteps(buildStepsFromApi(res.data.steps))
      setStatus('ready')
    }).catch(() => {
      if (alive) setStatus('error')
    })

    return () => {
      alive = false
    }
  }, [accountLoading, selectedAccountId])

  const reasons = stoppedReasons(steps)

  return (
    <div className={styles.page}>
      {status !== 'ready' ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : (
        <>
          <div className={styles.progress} role="note">
            <div>
              <strong>{progressHeadline(steps)}</strong>
              <span>
                順番はおすすめです。飛ばして進んでもかまいません。終わったかどうかは、画面を開いたかではなく、実際に作られたもので判断します。
              </span>
            </div>
            <span className={styles.headlineNote}>
              全部終わると、ダッシュボードの帯は出なくなります
            </span>
          </div>

          <div className={styles.columns}>
            <ol className={styles.steps} aria-label="はじめの設定の順路">
              {steps.map((step) => (
                <StepRow key={step.key} step={step} />
              ))}
            </ol>

            <aside className={styles.side} aria-label="この画面の案内">
              {reasons.length > 0 ? (
                <section className={styles.reason}>
                  <h2 className={styles.reasonTitle}>いま止まっている理由</h2>
                  {reasons.map((line) => (
                    <p key={line} className={styles.reasonLine}>
                      {line}
                    </p>
                  ))}
                </section>
              ) : null}
              <FeatureLinkCard items={[...FEATURE_LINKS]} />
              <CareCard items={[...CARE_ITEMS]} />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function StepRow({ step }: { step: StepResult }) {
  const done = step.state === 'done'
  return (
    <li className={styles.step} data-step-state={step.state}>
      <span className={done ? [styles.mark, styles.markDone].join(' ') : styles.mark} aria-hidden>
        {done ? '✓' : step.ordinal}
      </span>
      <div className={styles.stepBody}>
        <div className={styles.stepHead}>
          <h2 className={styles.stepTitle}>{step.title}</h2>
          <StatusBadge tone={STATE_TONE[step.state]} size="compact">
            {STEP_STATE_LABEL[step.state]}
          </StatusBadge>
        </div>
        <p className={styles.stepLine}>
          <span className={styles.stepLabel}>終わったと見なす条件：</span>
          {step.condition}
        </p>
        <p className={styles.stepLine}>
          <span className={styles.stepLabel}>次にすること：</span>
          {step.next}
        </p>
        {step.action ? (
          <Link href={step.action.href} className={styles.stepAction}>
            {step.action.label}
          </Link>
        ) : (
          <span className={styles.stepBlocked}>{step.blockedReason}</span>
        )}
      </div>
    </li>
  )
}
