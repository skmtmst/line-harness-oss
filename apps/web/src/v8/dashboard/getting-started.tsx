'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, X } from 'lucide-react'
import { api, type GettingStartedStep } from '@/lib/api'
import styles from './dashboard.module.css'

/*
 * はじめの設定の帯（WQmep「はじめの設定」）。
 * 数え方は v7 の帯（components/dashboard/getting-started-band）と同じ：
 * サーバの段（5段）をそのまま数え、終わった・閉じた・取れないときは出さない。
 * 「次は」は終わっていない最初の段の名前。名前は はじめの設定 の画面と同じ言葉。
 */
const STEP_TITLES: Record<string, string> = {
  accounts: 'LINE アカウントをつなぐ',
  featureSet: '使う機能の初期セット',
  attributes: '友だちの分け方を決める',
  friendAdd: '友だち追加時の配信を作る',
  scenario: 'シナリオを作る',
  firstMessage: '最初の1通を受け取る',
}

export type GettingStartedSummary = { done: number; total: number; next: string | null }

export function summarizeSteps(steps: ReadonlyArray<Pick<GettingStartedStep, 'key' | 'state'>>): GettingStartedSummary | null {
  if (steps.length === 0) return null
  const done = steps.filter((step) => step.state === 'done').length
  if (done === steps.length) return null
  const next = steps.find((step) => step.state !== 'done')
  return { done, total: steps.length, next: next ? STEP_TITLES[next.key] ?? null : null }
}

export function useGettingStarted(accountId: string | null) {
  const [summary, setSummary] = useState<GettingStartedSummary | null>(null)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSummary(null)
    api.gettingStarted
      .get(accountId ?? undefined)
      .then((res) => {
        if (cancelled || !res.success || res.data.dismissed) return
        setSummary(summarizeSteps(res.data.steps))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [accountId])
  const dismiss = () => {
    setHidden(true)
    void api.gettingStarted.dismiss().catch(() => undefined)
  }
  return { summary: hidden ? null : summary, dismiss }
}

export function GettingStartedBand({ summary, onDismiss }: { summary: GettingStartedSummary; onDismiss: () => void }) {
  const rate = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0
  return (
    <div role="note" className={styles.startBand}>
      <span className={styles.startTitle}>{`はじめの設定 ${summary.done} / ${summary.total} が完了`}</span>
      <span
        className={styles.startTrack}
        role="progressbar"
        aria-label="はじめの設定の進み"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.done}
      >
        <span className={styles.startFill} style={{ width: `${rate}%` }} />
      </span>
      <span className={styles.startNext}>{summary.next ? `次は「${summary.next}」` : ''}</span>
      <Link href="/getting-started" className={styles.textLink}>
        順路を見る<ArrowRight size={12} aria-hidden="true" />
      </Link>
      <button type="button" aria-label="この案内を閉じる" className={styles.startClose} onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
