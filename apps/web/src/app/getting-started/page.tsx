'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { loadFeatureSettings } from '@/lib/feature-settings-cache'
import { featureSetEntry } from './feature-presets'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import {
  CARE_ITEMS,
  type StepResult,
  buildStepsFromApi,
  doneCount,
  insertFeatureSet,
  progressHeadline,
  stoppedReasons,
} from './getting-started-view'
import { FEATURE_SETTINGS_UPDATED_EVENT } from '@/lib/feature-settings'
import styles from './getting-started.module.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import GettingStartedV8 from '@/v8/settings/getting-started/getting-started'

/**
 * 設計板 xuJ7D「はじめの設定」。6段の順路。
 *
 * 板の骨組み（進み具合の帯・6行・下の2枚）だけを出す。段の状態・権限・
 * 行き先は口を正本にし、初期セット（段2）は機能設定の実物で確かめる。
 */
function GettingStartedPageV7() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // M017：捕まえた失敗を共通部品へ渡すために持つ。
  const [loadError, setLoadError] = useState<unknown>(null)

  /*
   * M017：読み込み失敗面に再試行口を付ける。押すとここへ戻る。
   * 読み直しを押した瞬間に読込面へ切り替わるので、二度押しはできない。
   */
  const load = useCallback(async () => {
    if (accountLoading) return
    const accountId = selectedAccountId
    setStatus('loading')
    setLoadError(null)
    try {
      const res = await api.gettingStarted.get(accountId ?? undefined, 'v8')
      if (!res.success) throw new Error(res.error)
      // 初期セット（段2）は機能設定の実物で確かめる。取れなければ未確認のまま。
      let entry = null
      if (accountId) {
        try {
          const features = await loadFeatureSettings(accountId)
          if (!features.success) throw new Error(features.error)
          entry = featureSetEntry({ forbidden: false, version: features.data.version ?? 0 })
        } catch (caught) {
          entry = caught instanceof ApiError && caught.status === 403 ? { kind: 'forbidden' } as const : null
        }
      }
      setSteps(res.data.steps.some(step => step.key === 'featureSet')
        ? buildStepsFromApi(res.data.steps)
        : insertFeatureSet(buildStepsFromApi(res.data.steps), entry))
      setStatus('ready')
    } catch (caught) {
      setLoadError(caught)
      setStatus('error')
    }
  }, [accountLoading, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const refresh = () => { void load() }
    window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(FEATURE_SETTINGS_UPDATED_EVENT, refresh)
  }, [load])

  const reasons = stoppedReasons(steps)
  const done = doneCount(steps)

  return (
    <div className={`${styles.page} v8-ro-notifications-page`} data-design-node="xuJ7D">
      <ReadonlyHeaderV8 title="はじめの設定" description="musubo を使いはじめるまでの6つの手順です。上から順に進めると、最初の1通が届くまでたどり着けます。" />
      {/*
        読込面（loading）では共通部品が onRetry を見ない。
        失敗面にだけ再試行口が出る。
      */}
      {status !== 'ready' ? (
        <ListState
          kind={status === 'error' ? 'error' : 'loading'}
          error={status === 'error' ? loadError : undefined}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {/* 板の進み具合の帯。数は実測だけ。 */}
          <div className={styles.progress} role="note">
            <strong>{progressHeadline(steps)}</strong>
            <div className={styles.bar} aria-hidden="true">
              <div
                className={styles.barFill}
                style={{ width: steps.length > 0 ? `${(done / steps.length) * 100}%` : '0%' }}
              />
            </div>
          </div>

          <ol className={styles.steps} aria-label="はじめの設定の順路" data-design-node="BOj1a">
            {steps.map((step) => (
              <StepRow key={step.key} step={step} />
            ))}
          </ol>

          <div className={styles.bottom}>
            {reasons.length > 0 ? (
              <section className={styles.card} aria-label="いま止まっている理由">
                <h2 className={styles.cardTitle}>いま止まっている理由</h2>
                {reasons.map((line) => (
                  <p key={line} className={styles.cardLine}>
                    {line}
                  </p>
                ))}
              </section>
            ) : null}
            <section className={styles.card} aria-label="気をつけること">
              <h2 className={styles.cardTitle}>気をつけること</h2>
              <ul className={styles.careList}>
                {CARE_ITEMS.map((item) => (
                  <li key={item.head}>{item.head}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 板の1行。終わりは緑の丸と「済み」の札、まだは番号の丸と行き先のボタン。
 * 押せない段は理由の文字だけ出す。
 */
function StepRow({ step }: { step: StepResult }) {
  const done = step.state === 'done'
  return (
    <li className={styles.step} data-step-state={step.state}>
      <span className={done ? [styles.mark, styles.markDone].join(' ') : styles.mark} aria-hidden>
        {done ? '✓' : step.ordinal}
      </span>
      <div className={styles.stepBody}>
        <p className={styles.stepTitle}>{step.title}</p>
        <p className={styles.stepSub}>{step.sub}</p>
      </div>
      <div className={styles.stepSide}>
        {done ? (
          <StatusBadge tone="success" size="compact">済み</StatusBadge>
        ) : step.action ? (
          <Button href={step.action.href} variant="secondary">{step.action.label}</Button>
        ) : (
          <span className={styles.stepBlocked}>{step.blockedReason}</span>
        )}
      </div>
    </li>
  )
}

/** ★V8：data-theme="v8" のときだけ新しい画面（src/v8/settings/getting-started）を出す。 */
export default function GettingStartedPage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <GettingStartedV8 /> : <GettingStartedPageV7 />
}
