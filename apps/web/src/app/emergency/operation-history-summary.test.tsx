// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationHistoryEntry } from '@/lib/api'
import EmergencyPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const historyFixture = vi.hoisted(() => ({ data: [] as OperationHistoryEntry[] }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      operations: {
        ...actual.api.operations,
        history: () => Promise.resolve({ success: true as const, data: historyFixture.data }),
      },
    },
  }
})

const { HistoryPanel } = EmergencyPage.__test

const DAY = 24 * 60 * 60 * 1000

function incident(id: string, daysAgo: number, stopMinutes?: number): OperationHistoryEntry {
  const createdAt = new Date(Date.now() - daysAgo * DAY).toISOString()
  const stoppedAt = stopMinutes !== undefined ? createdAt : null
  const resolvedAt = stopMinutes !== undefined
    ? new Date(Date.parse(createdAt) + stopMinutes * 60_000).toISOString()
    : null
  return {
    id,
    scopeKey: 'account-1',
    lineAccountId: 'account-1',
    status: 'resolved',
    capabilities: ['broadcast_dispatch'],
    reason: `理由-${id}`,
    detail: null,
    actorId: 'owner-1',
    resolvedByActorId: 'owner-1',
    controlVersion: 1,
    beforeSnapshot: {} as OperationHistoryEntry['beforeSnapshot'],
    stoppedSnapshot: null,
    restoredSnapshot: null,
    errorMessage: null,
    stoppedAt,
    resolvedAt,
    createdAt,
    updatedAt: createdAt,
    historyKind: 'incident',
    occurredAt: createdAt,
  }
}

function summaryCard(label: string) {
  const labelEl = screen.getByText(label)
  const card = labelEl.closest('div')
  if (!card) throw new Error(`summary card not found: ${label}`)
  return within(card)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  historyFixture.data = []
})

describe('運用履歴の期間集計(N-454)', () => {
  it('一覧・止めた回数・最長停止が選択した表示期間に一貫する', async () => {
    historyFixture.data = [
      incident('recent', 10, 30),   // 10日前・停止30分
      incident('old', 200, 120),    // 200日前・停止120分
    ]
    render(<HistoryPanel />)
    await flush()

    // 既定「この1年」: 2件とも数える
    expect(summaryCard('止めた回数').getByText('2回')).toBeTruthy()
    expect(summaryCard('止めた回数').getByText('この1年')).toBeTruthy()
    // 監査6 #674: 分の生値は眺める画面で読めないため「約2時間」へ人間化
    expect(summaryCard('いちばん長かった停止').getByText('約2時間')).toBeTruthy()
    expect(screen.getByText('理由-recent')).toBeTruthy()
    expect(screen.getByText('理由-old')).toBeTruthy()

    // 「この30日」へ切替: 一覧も概要も同じ期間で絞る
    fireEvent.change(screen.getByLabelText('表示期間'), { target: { value: '30days' } })
    await flush()
    expect(summaryCard('止めた回数').getByText('1回')).toBeTruthy()
    expect(summaryCard('止めた回数').getByText('この30日')).toBeTruthy()
    expect(summaryCard('いちばん長かった停止').getByText('30分')).toBeTruthy()
    expect(screen.getByText('理由-recent')).toBeTruthy()
    expect(screen.queryByText('理由-old')).toBeNull()
  })

  it('30日ちょうどの境界は30日側へ含める', async () => {
    historyFixture.data = [
      incident('inside', 29.9),
      incident('outside', 31),
    ]
    render(<HistoryPanel />)
    await flush()
    fireEvent.change(screen.getByLabelText('表示期間'), { target: { value: '30days' } })
    await flush()

    expect(screen.getByText('理由-inside')).toBeTruthy()
    expect(screen.queryByText('理由-outside')).toBeNull()
    expect(summaryCard('止めた回数').getByText('1回')).toBeTruthy()
  })

  it('200件の表示上限に達したら総数を「以上」と示して誤らない', async () => {
    historyFixture.data = Array.from({ length: 200 }, (_, i) => incident(`n${i}`, 1))
    render(<HistoryPanel />)
    await flush()

    expect(summaryCard('止めた回数').getByText('200回以上')).toBeTruthy()
    expect(summaryCard('止めた回数').queryByText('200回')).toBeNull()
  })
})
