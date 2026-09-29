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
import { FeatureSetCard } from './feature-set-card'
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
  // 主役は「いまの手順」（終わっていない最初の段）だけ。他の段の行き先は枠にする。
  const currentKey = steps.find((step) => step.state !== 'done')?.key ?? null

  return (
    <div className={styles.page}>
      {status !== 'ready' ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : (
        <>
          {/*
            帯は進み具合の1行だけ。順番の飛ばし方・終わりの判断基準・
            ダッシュボードの帯の扱いは右の「気をつけること」が持つため、
            ここでは繰り返さない（★V7 帯は1本）。
          */}
          <div className={styles.progress} role="note">
            <strong>{progressHeadline(steps)}</strong>
          </div>

          {/*
            IDEA-31: 初回案内で業種・担当業務に合う初期セットを選べるようにする。
            順路の段には含めない（段はサーバ判定の5段で固定）。保存済みの設定や
            メニューの並びをここからリセットしないのは FeatureSetCard が守る。
          */}
          <FeatureSetCard accountId={selectedAccountId} />

          <div className={styles.columns}>
            <ol className={styles.steps} aria-label="はじめの設定の順路">
              {steps.map((step) => (
                <StepRow key={step.key} step={step} current={step.key === currentKey} />
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

function StepRow({ step, current }: { step: StepResult; current: boolean }) {
  const done = step.state === 'done'
  return (
    <li className={styles.step} data-step-state={step.state} data-current={current ? 'true' : 'false'}>
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
