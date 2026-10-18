'use client'

/*
 * ★V8 はじめの設定（Pencil `xuJ7D`）。
 *
 * 白い板の頭（題と説明）→ 左に「設定の中のメニュー」→ 右に
 * 進み具合の帯・6段の表・下の2枚（いま止まっている理由・気をつけること）。
 * データの口は今の画面（app/getting-started/page.tsx）と同じ：
 * はじめの設定の口（`'v8'` の6段）と、段2を確かめる機能設定の実物。
 */
import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { loadFeatureSettings } from '@/lib/feature-settings-cache'
import { FEATURE_SETTINGS_UPDATED_EVENT } from '@/lib/feature-settings'
import { usePageTitle } from '@/components/shell/page-chrome'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import { ProgressBar } from '@/components/shared/progress'
import { GridTable, GridRow, GridCell } from '@/components/shared/grid-table'
import TruncatedText from '@/components/shared/truncated-text'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import {
  type StepResult,
  buildStepsFromApi,
  doneCount,
  featureSetEntry,
  insertFeatureSet,
  progressHeadline,
  stoppedReasons,
} from './steps'
import frame from '../sa-frame.module.css'
import styles from './getting-started.module.css'

/** 板の下の「気をつけること」（絵の2行）。 */
const CARE_LINES = ['・手順は飛ばしても使えます', '・あとからこの画面に戻れます（設定 › はじめの設定）'] as const

export default function GettingStartedV8() {
  usePageTitle('はじめの設定')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (accountLoading) return
    const accountId = selectedAccountId
    setStatus('loading')
    setLoadError(null)
    try {
      const res = await api.gettingStarted.get(accountId ?? undefined, 'v8')
      if (!res.success) throw new Error(res.error)
      // 段2（初期セット）は機能設定の実物で確かめる。取れなければ未確認のまま。
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
      setSteps(res.data.steps.some((step) => step.key === 'featureSet')
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

  // 機能設定で保存されたら段2を読み直す。
  useEffect(() => {
    const refresh = () => { void load() }
    window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(FEATURE_SETTINGS_UPDATED_EVENT, refresh)
  }, [load])

  const reasons = stoppedReasons(steps)
  const done = doneCount(steps)

  return (
    <div className={frame.screen}>
      <SettingsPage layout="accounts" heightMode="content"
        boardId="xuJ7D"
        title="はじめの設定"
        help="musubo を使いはじめるまでの6つの手順です。上から順に進めると、最初の1通が届くまでたどり着けます。"
        navigation={<SettingsInnerNav inline />}
      >
        {status !== 'ready' ? (
          <ListState
            kind={status === 'error' ? 'error' : 'loading'}
            error={status === 'error' ? loadError : undefined}
            onRetry={() => void load()}
          />
        ) : (
          <>
            <div className={styles.progress} role="note">
              <strong className={styles.progressText}>{progressHeadline(steps)}</strong>
              <ProgressBar className={styles.bar} value={100 * done / Math.max(steps.length, 1)} label="はじめの設定の進み具合" />
            </div>

            <Card padding="rows" overflow="hidden">
              <GridTable label="はじめの設定の順路" framed={false} design={{ columns: "max-content minmax(0, 1fr) max-content", gap: "var(--polish-space-card)", rowPadding: "var(--polish-space-card)", fontSize: "var(--text-body)" }}>
                {steps.map((step) => <StepRow key={step.key} step={step} />)}
              </GridTable>
            </Card>

            <div className={styles.bottom}>
              {reasons.length > 0 ? (
                <Card variant="form" className={styles.card} aria-label="いま止まっている理由">
                  <CardHeader size="stacked" title="いま止まっている理由" />
                  {reasons.map((line) => <p key={line} className={styles.cardLine}>{line}</p>)}
                </Card>
              ) : null}
              <Card variant="form" className={styles.card} aria-label="気をつけること">
                <CardHeader size="stacked" title="気をつけること" />
                <p className={styles.cardLine}>
                  {CARE_LINES[0]}
                  <br />
                  {CARE_LINES[1]}
                </p>
              </Card>
            </div>
          </>
        )}
      </SettingsPage>
    </div>
  )
}

/** 1段。済みは緑の丸と札、まだは番号の丸と行き先のボタン。押せない段は理由の文字。 */
function StepRow({ step }: { step: StepResult }) {
  const done = step.state === 'done'
  return (
    <GridRow data-step-state={step.state}>
      <GridCell><span className={`${styles.mark} ${done ? styles.markDone : ''}`} aria-label={done ? '済み' : `手順${step.ordinal}`}>{done ? <Check size={16} aria-hidden="true" /> : step.ordinal}</span></GridCell>
      <GridCell><div className={styles.stepBody}>
        <strong className={done ? styles.stepDoneTitle : undefined}><TruncatedText value={step.title} /></strong>
        <span className={styles.stepSub}><TruncatedText value={step.sub} /></span>
      </div></GridCell>
      <GridCell align="right">
        {done ? <StatusBadge tone="success" size="compact">済み</StatusBadge> : step.action ? (
          <Button href={step.action.href} variant="secondary">{step.action.label}</Button>
        ) : <span className={styles.stepBlocked}>{step.blockedReason}</span>}
      </GridCell>
    </GridRow>
  )
}
