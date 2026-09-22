// @vitest-environment happy-dom
/*
 * OPERATIONS-01: 「管理画面の更新」欄の件数と案内の一致を確かめる。
 *
 * 監査での再現: 説明は「新しい10件」なのに `.slice(0, 4)` で4件打切り、
 * 5件目以降への案内もなかった。0/4/10/12件それぞれで案内と実際の行数、
 * 新しい順、続きの案内を試す。
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationHistoryEntry } from '@/lib/api'
import EmergencyPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

type ReleaseEntry = { kind: string; text: string; by: string | null; pr: number | null; at: string | null }
type Release = { version: string; released: string | null; entries: ReleaseEntry[] }

const fixture = vi.hoisted(() => ({
  history: [] as OperationHistoryEntry[],
  releases: [] as Release[],
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      operations: {
        ...actual.api.operations,
        history: () => Promise.resolve({ success: true as const, data: fixture.history }),
      },
    },
  }
})

vi.mock('@/generated/release-log.json', () => ({
  default: {
    // 各テストで fixture.releases を入れ替えるので、参照は毎回遅延にする。
    get releases() { return fixture.releases },
  },
}))

const { HistoryPanel } = EmergencyPage.__test

function releaseEntries(count: number, prefix = '更新'): ReleaseEntry[] {
  // 新しい順に 更新-01 が先頭になるよう、番号が大きいほど古い日付にする。
  return Array.from({ length: count }, (_, i) => ({
    kind: 'fixed',
    text: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    by: 'kenta',
    pr: 100 + i,
    at: `2026-09-${String(20 - i).padStart(2, '0')}`,
  }))
}

function releasedLog(entries: ReleaseEntry[]): Release[] {
  return [{ version: '1.0.0', released: '2026-09-25', entries }]
}

function updateSection(): HTMLElement {
  const heading = screen.getByRole('heading', { name: '管理画面の更新' })
  const section = heading.closest('section')
  if (!section) throw new Error('管理画面の更新 section が見つかりません')
  return section
}

function updateRows(section: HTMLElement): HTMLElement[] {
  return within(section).queryAllByTitle(/^更新-/)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  fixture.history = []
  fixture.releases = []
})

describe('管理画面の更新欄(OPERATIONS-01)', () => {
  it('0件なら案内どおり「記録はありません」とだけ出す', async () => {
    fixture.releases = releasedLog([])
    render(<HistoryPanel />)
    await flush()

    const section = updateSection()
    expect(within(section).getByText(/新しい10件を表示します/)).toBeTruthy()
    expect(within(section).getByText('更新の記録はありません。')).toBeTruthy()
    expect(within(section).queryByText(/続きが/)).toBeNull()
  })

  it('4件なら4行だけ出し、続きの案内は出さない', async () => {
    fixture.releases = releasedLog(releaseEntries(4))
    render(<HistoryPanel />)
    await flush()

    const section = updateSection()
    expect(updateRows(section)).toHaveLength(4)
    expect(within(section).queryByText(/続きが/)).toBeNull()
  })

  it('10件ならちょうど10行出し、続きの案内は出さない', async () => {
    fixture.releases = releasedLog(releaseEntries(10))
    render(<HistoryPanel />)
    await flush()

    const section = updateSection()
    const rows = updateRows(section)
    expect(rows).toHaveLength(10)
    expect(within(section).queryByText(/続きが/)).toBeNull()
  })

  it('12件なら新しい順に10行出し、続きが2件あると案内する', async () => {
    fixture.releases = releasedLog(releaseEntries(12))
    render(<HistoryPanel />)
    await flush()

    const section = updateSection()
    const rows = updateRows(section)
    expect(rows).toHaveLength(10)
    expect(within(section).getByText('更新-01')).toBeTruthy()
    expect(within(section).getByText('更新-10')).toBeTruthy()
    expect(within(section).queryByText('更新-11')).toBeNull()
    expect(within(section).queryByText('更新-12')).toBeNull()
    expect(within(section).getByText(/続きが2件あります/)).toBeTruthy()
  })

  it('まだ画面に入っていない変更は行に混ぜず、件数だけ別に案内する', async () => {
    fixture.releases = [
      { version: 'unreleased', released: null, entries: releaseEntries(3, '更新') },
      ...releasedLog(releaseEntries(2, '配備済み')),
    ]
    render(<HistoryPanel />)
    await flush()

    const section = updateSection()
    // 配備済みの2行だけが出る。未配備の3件は行にしない。
    expect(within(section).queryAllByTitle(/^配備済み-/)).toHaveLength(2)
    expect(within(section).queryByTitle(/^更新-/)).toBeNull()
    expect(within(section).getByText(/まだ画面に入っていない変更が3件あります/)).toBeTruthy()
  })
})
