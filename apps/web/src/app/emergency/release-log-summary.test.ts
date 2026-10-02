/*
 * V6R-S3-a: 運用状態の画面は更新履歴の全文ではなく要約を読む。
 *
 * 要約は本文を「反映済みの新しい行」だけに削るので、削っても画面に出る値
 * （新しい10行・続きの件数・未反映の件数・30日の行数・いまの版）が全文のときと
 * 変わらないことを、同じ関数に全文と要約を通して比べる。
 */
import { describe, expect, it } from 'vitest'
import { summarize } from '../../../scripts/build-release-log.mjs'
import type { OperationHistoryEntry } from '@/lib/api'
import { collectRecentUpdates, RECENT_UPDATES_LIMIT, releaseEntryCount, type UpdateRelease } from './update-history'

function entries(count: number, prefix: string, day: (i: number) => string) {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'fixed', text: `${prefix}-${i}`, by: 'kenta', pr: i, at: day(i),
  }))
}

/** 本番に近い形: 未反映が大量、反映済みが複数の版にまたがり、日時が混ざる。 */
const full: UpdateRelease[] = [
  { version: 'unreleased', released: null, entries: entries(300, '未反映', () => '2026-09-23T10:00') },
  { version: '0.24.0', released: '2026-09-20', entries: entries(40, '新', (i) => `2026-09-${String(19 - (i % 10)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`) },
  { version: '0.23.0', released: '2026-09-01', entries: entries(35, '旧', (i) => (i % 3 === 0 ? null : `2026-08-${String(28 - (i % 20)).padStart(2, '0')}`)) as UpdateRelease['entries'] },
]

const deployments = Array.from({ length: 4 }, (_, i) => ({
  reason: `配備-${i}`,
  actorId: 'ci',
  occurredAt: `2026-09-${String(18 - i * 3).padStart(2, '0')}T09:00:00Z`,
  createdAt: `2026-09-${String(18 - i * 3).padStart(2, '0')}T09:00:00Z`,
  deployment: { actor: 'ci', pullRequest: null, version: `v${i}`, environment: 'staging', phase: 'succeeded' },
})) as unknown as OperationHistoryEntry[]

function shown(releases: UpdateRelease[], deploys: OperationHistoryEntry[]) {
  const { updates, pendingCount, totalCount } = collectRecentUpdates(deploys, releases)
  return {
    rows: updates.slice(0, RECENT_UPDATES_LIMIT).map((row) => `${row.version}|${row.text}`),
    hidden: totalCount - Math.min(RECENT_UPDATES_LIMIT, updates.length),
    pendingCount,
    releasedLines: releases.filter((r) => r.released).reduce((n, r) => n + releaseEntryCount(r), 0),
    currentVersion: releases.find((r) => r.released)?.version,
  }
}

describe('運用状態の更新履歴の要約（V6R-S3-a）', () => {
  it('要約でも、画面に出る値は全文と同じ', () => {
    const summary = summarize(full).releases as UpdateRelease[]
    expect(shown(summary, deployments)).toEqual(shown(full, deployments))
    expect(shown(summary, [])).toEqual(shown(full, []))
  })

  it('要約は本文を削り、行数は残す（全文を持ち込まない）', () => {
    const summary = summarize(full).releases as UpdateRelease[]
    const kept = summary.reduce((n, r) => n + r.entries.length, 0)
    expect(kept).toBeLessThanOrEqual(50)
    expect(summary.find((r) => r.released === null)?.entries).toHaveLength(0)
    expect(summary.map((r) => r.entryCount)).toEqual([300, 40, 35])
  })
})
