'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { canManageRole } from '@/lib/staff-role'
import styles from './first-steps.module.css'

/*
 * ダッシュボードの「はじめにやること」（★V8 修正案 D-3・2026-10-07 オーナー採用、絵 `r3X34`）。
 *
 * - いちばん上（板の頭の下）にカード1枚。「はじめにやること　n / 6 済み」＋進みの線＋「閉じる」、
 *   手順6つを3列×2行。済んだ手順は ✓、まだの手順は右に行き先のリンク。
 * - 済んだかどうかは、今ある口から自動で判定する（画面で手で付けない）。
 * - 1つでも判定できなかった（読めなかった）ときは出さない。分からないものを「まだ」と言って急かさない。
 * - 全部済むか「閉じる」で消える。閉じたことはアカウントごとに覚える。サーバに
 *   アカウントごとの口が無い（今の「はじめの設定」の閉じるは本人単位）ので、この端末の localStorage に置く。
 * - オーナー・管理者にだけ出す。
 */

export type FirstStepKey = 'connect' | 'greeting' | 'richMenu' | 'broadcast' | 'scenario' | 'invite'

export const FIRST_STEPS: ReadonlyArray<{ key: FirstStepKey; label: string; href: string; link: string }> = [
  { key: 'connect', label: 'LINE 公式アカウントをつなぐ', href: '/accounts', link: 'つなぐ →' },
  { key: 'greeting', label: '友だち追加のあいさつを決める', href: '/friend-add-settings?view=new', link: '決める →' },
  { key: 'richMenu', label: 'リッチメニューを公開する', href: '/rich-menus', link: '公開する →' },
  { key: 'broadcast', label: '最初の一斉配信を送る', href: '/broadcasts/new', link: '作る →' },
  { key: 'scenario', label: 'シナリオを1つ動かす', href: '/scenarios', link: '作る →' },
  { key: 'invite', label: 'ログインユーザーを招待する', href: '/staff', link: '招待する →' },
]

/** 口ごとの答え。`null` は「読めなかった（判定できない）」。 */
export type FirstStepFacts = Record<FirstStepKey, boolean | null>

export type FirstStepsSummary = {
  steps: Array<{ key: FirstStepKey; label: string; href: string; link: string; done: boolean }>
  done: number
  total: number
}

/** 判定の結果を数える。1つでも判定できなければ null（出さない）。 */
export function summarizeFirstSteps(facts: FirstStepFacts): FirstStepsSummary | null {
  if (FIRST_STEPS.some((step) => facts[step.key] === null || facts[step.key] === undefined)) return null
  const steps = FIRST_STEPS.map((step) => ({ ...step, done: facts[step.key] === true }))
  return { steps, done: steps.filter((step) => step.done).length, total: steps.length }
}

/** 出すか。オーナー・管理者だけ・閉じていない・済んでいない手順がある。 */
export function shouldShowFirstSteps(role: string | null, summary: FirstStepsSummary | null, dismissed: boolean): boolean {
  if (!canManageRole(role)) return false
  if (dismissed || !summary) return false
  return summary.done < summary.total
}

export function firstStepsStorageKey(accountId: string): string {
  return `lh:v8:first-steps-dismissed:${accountId}`
}

function readDismissed(accountId: string | null): boolean {
  if (!accountId || typeof window === 'undefined') return false
  try { return window.localStorage.getItem(firstStepsStorageKey(accountId)) === '1' } catch { return false }
}

/** 読めた・読めなかったを分ける。失敗・形が違う答えは null。 */
async function fact(load: () => Promise<boolean>): Promise<boolean | null> {
  try { return await load() } catch { return null }
}

/** 今ある口から6つを判定する。 */
export async function loadFirstStepFacts(accountId: string): Promise<FirstStepFacts> {
  const [connect, greeting, richMenu, broadcast, scenario, invite] = await Promise.all([
    /* アカウントの接続状態：はじめの設定の段1（稼働中・Webhook が合っている・シークレットあり）。 */
    fact(async () => {
      const res = await api.gettingStarted.get(accountId)
      if (!res.success) throw new Error(res.error)
      const step = res.data.steps.find((item) => item.key === 'accounts')
      if (!step) throw new Error('no accounts step')
      return step.state === 'done'
    }),
    /* 友だち追加時の配信（初回）が公開されているか。 */
    fact(async () => {
      const res = await api.friendAddRules.list(accountId, 'first_time', { status: 'published', limit: 1 })
      if (!res.success) throw new Error(res.error)
      return res.data.items.some((rule) => rule.status === 'published')
    }),
    /* 公開中のリッチメニューがあるか。 */
    fact(async () => {
      const res = await api.richMenuGroups.listPage(accountId, { page: 1, limit: 1, filter: 'published' })
      if (!res.success) throw new Error(res.error)
      return (res.data.facets?.published ?? res.data.items.filter((group) => group.status === 'published').length) > 0
    }),
    /* 送信済みの一斉配信があるか。 */
    fact(async () => {
      const res = await api.broadcasts.list({ accountId, displayStatus: 'sent', limit: 1 })
      if (!res.success) throw new Error(res.error)
      return res.data.some((broadcast) => broadcast.status === 'sent')
    }),
    /* 稼働中のシナリオがあるか。 */
    fact(async () => {
      const res = await api.scenarios.listPage({ accountId, active: 1, limit: 1 })
      if (!res.success) throw new Error(res.error)
      return res.data.items.some((scenario) => scenario.isActive)
    }),
    /* ログインユーザーが自分のほかにいるか（招待中も含む）。 */
    fact(async () => {
      const res = await api.staff.list()
      if (!res.success) throw new Error(res.error)
      return res.data.length > 1
    }),
  ])
  return { connect, greeting, richMenu, broadcast, scenario, invite }
}

export function useFirstSteps(accountId: string | null, role: string | null) {
  const [summary, setSummary] = useState<FirstStepsSummary | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const enabled = canManageRole(role)
  useEffect(() => {
    setSummary(null)
    setDismissed(readDismissed(accountId))
    if (!accountId || !enabled || readDismissed(accountId)) return
    let cancelled = false
    void loadFirstStepFacts(accountId).then((facts) => {
      if (!cancelled) setSummary(summarizeFirstSteps(facts))
    })
    return () => { cancelled = true }
  }, [accountId, enabled])
  const dismiss = useCallback(() => {
    setDismissed(true)
    if (!accountId) return
    try { window.localStorage.setItem(firstStepsStorageKey(accountId), '1') } catch { /* 覚えられなくても今は閉じる */ }
  }, [accountId])
  return { summary: shouldShowFirstSteps(role, summary, dismissed) ? summary : null, dismiss }
}

export function FirstStepsCard({ summary, onDismiss }: { summary: FirstStepsSummary; onDismiss: () => void }) {
  const rate = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0
  return (
    <section className={styles.card} aria-labelledby="first-steps-title" data-design-node="r3X34">
      <div className={styles.head}>
        <h2 id="first-steps-title" className={styles.title}>はじめにやること</h2>
        <span className={styles.count}>{`${summary.done} / ${summary.total} 済み`}</span>
        <span
          className={styles.track}
          role="progressbar"
          aria-label="はじめにやることの進み"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.done}
        >
          <span className={styles.fill} style={{ width: `${rate}%` }} />
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.close} onClick={onDismiss}>閉じる</button>
      </div>
      <ul className={styles.grid}>
        {summary.steps.map((step) => (
          <li key={step.key} className={styles.step} data-done={step.done ? '' : undefined}>
            <span className={styles.check} aria-hidden="true">{step.done ? '✓' : null}</span>
            <span className={styles.label}>
              {step.label}
              <span className="sr-only">{step.done ? '（済み）' : '（まだ）'}</span>
            </span>
            {step.done ? null : (
              <>
                <span className={styles.spacer} />
                <Link href={step.href} className={styles.link} aria-label={`${step.label}（${step.link.replace(' →', '')}）`}>{step.link}</Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
