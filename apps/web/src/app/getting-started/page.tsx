'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'
import {
  CARE_ITEMS,
  FEATURE_LINKS,
  STEP_STATE_LABEL,
  type GettingStartedInput,
  type StepResult,
  type StepState,
  buildSteps,
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
  const [input, setInput] = useState<GettingStartedInput | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (accountLoading) return
    const accountId = selectedAccountId
    let alive = true
    setStatus('loading')

    /*
      判定はサーバから取った実物だけで計算する。**キャッシュしない。**
      `GET /api/getting-started` は無いので、いまある口を並べて数える
      （足りないのは最終確認の「1通届いたか」だけ。§firstMessageStep）。
    */
    void Promise.all([
      api.lineAccounts.list().catch(() => null),
      api.tags.list().catch(() => null),
      accountId ? api.friendFields.list(accountId).catch(() => null) : Promise.resolve(null),
      accountId ? api.friendAddRouting.get(accountId).catch(() => null) : Promise.resolve(null),
      accountId ? api.friendAddRouting.getDraft(accountId).catch(() => null) : Promise.resolve(null),
      api.scenarios.list().catch(() => null),
      api.staff.me().catch(() => null),
    ]).then(([accounts, tags, fields, routing, draft, scenarios, me]) => {
      if (!alive) return
      if (!accounts?.success || !tags?.success || !scenarios?.success) {
        setStatus('error')
        return
      }
      setInput({
        accounts: accounts.data ?? [],
        tagCount: (tags.data ?? []).length,
        friendFieldCount: fields?.success ? (fields.data ?? []).length : 0,
        friendAdd: routing?.success && routing.data ? routing.data : null,
        friendAddDraft: draft?.success && draft.data ? draft.data : null,
        scenarios: scenarios.data ?? [],
        role: (me?.success ? me.data?.role : null) as StaffMember['role'] | null,
      })
      setStatus('ready')
    })

    return () => {
      alive = false
    }
  }, [accountLoading, selectedAccountId])

  const steps = input ? buildSteps(input) : []
  const reasons = input ? stoppedReasons(steps) : []

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: '設定' }, { label: 'はじめの設定' }]}
        title="はじめの設定"
        description="順番はおすすめです。飛ばして進んでもかまいません。終わったかどうかは、画面を開いたかではなく、実際に作られたもので判断します。"
      />

      {status !== 'ready' || !input ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : (
        <>
          <NoteBar tone="info">
            <strong className={styles.headline}>{progressHeadline(steps)}</strong>
            <span className={styles.headlineNote}>
              全部終わると、ダッシュボードの帯は出なくなります
            </span>
          </NoteBar>

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
