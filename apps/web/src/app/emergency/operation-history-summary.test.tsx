// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Blob as NodeBlob } from 'node:buffer'
import type { OperationHistoryEntry } from '@/lib/api'
import HistoryPanel from './page'

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => '/emergency', useSearchParams: () => new URLSearchParams('tab=history') }))
vi.mock('@/contexts/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'viewer', useStaffIdentity: () => ({ role: 'viewer', readOnly: false }) }))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の期間集計の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string
    id?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => (
    <select aria-label={label} id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const historyFixture = vi.hoisted(() => ({ data: [] as OperationHistoryEntry[], failed: false }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      health: { ...actual.api.health, accounts: async () => ({ success: true, data: [] }) },
      operations: {
        ...actual.api.operations,
        history: () => historyFixture.failed ? Promise.reject(new Error('network down')) : Promise.resolve({ success: true as const, data: historyFixture.data }),
      },
    },
  }
})


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
  const card = labelEl.closest('[data-kpi-presentation]')
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
  historyFixture.failed = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('運用履歴の期間集計(N-454)', () => {
  it('一覧・止めた回数・最長停止が選択した表示期間に一貫する', async () => {
    historyFixture.data = [
      incident('recent', 10, 30),   // 10日前・停止30分
      incident('old', 200, 120),    // 200日前・停止120分
    ]
    render(<HistoryPanel />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    await screen.findByRole('dialog', { name: '止めた・戻した記録' })
    await flush()

    // 既定「この1年」: 2件とも数える
    expect(summaryCard('止めた回数').getByText('2回')).toBeTruthy()
    expect(summaryCard('止めた回数').getByText('この1年')).toBeTruthy()
    // 監査6 #674: 分の生値は眺める画面で読めないため「約2時間」へ人間化
    expect(summaryCard('いちばん長かった停止').getByText('約2時間')).toBeTruthy()
    expect(screen.getByText('理由-recent')).toBeTruthy()
    expect(screen.getByText('理由-old')).toBeTruthy()

    // 「過去30日」へ切替: 一覧も概要も同じ期間で絞る
    fireEvent.change(screen.getByLabelText('表示期間'), { target: { value: '30days' } })
    await flush()
    expect(summaryCard('止めた回数').getByText('1回')).toBeTruthy()
    expect(summaryCard('止めた回数').getByText('過去30日')).toBeTruthy()
    expect(summaryCard('いちばん長かった停止').getByText('30分')).toBeTruthy()
    expect(screen.getByText('理由-recent')).toBeTruthy()
    expect(screen.queryByText('理由-old')).toBeNull()
  })

  it('30日ちょうどの境界は30日側へ含める', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    historyFixture.data = [
      incident('inside', 30),
      incident('outside', 31),
    ]
    render(<HistoryPanel />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    await screen.findByRole('dialog', { name: '止めた・戻した記録' })
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
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    await screen.findByRole('dialog', { name: '止めた・戻した記録' })
    await flush()

    expect(summaryCard('止めた回数').getByText('200回以上')).toBeTruthy()
    expect(summaryCard('止めた回数').queryByText('200回')).toBeNull()
  })

  it('読めない日付は件数を知らせ、期間の一覧とCSVへ混ぜない', async () => {
    historyFixture.data = [incident('valid', 1), { ...incident('invalid', 1), createdAt: 'invalid-date' }]
    render(<HistoryPanel />); await flush()
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    const dialog = await screen.findByRole('dialog', { name: '止めた・戻した記録' }); await flush()
    expect(within(dialog).getByText(/日付を読み取れない記録が1件/)).toBeTruthy()
    expect(within(dialog).getByText('理由-valid')).toBeTruthy()
    expect(within(dialog).queryByText('理由-invalid')).toBeNull()
    expect(summaryCard('止めた回数').getByText('1回')).toBeTruthy()
  })

  it('履歴の取得失敗は0回や空のCSVにせず、実際の読み直しから戻る', async () => {
    historyFixture.failed = true
    render(<HistoryPanel />); await flush()
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    const dialog = await screen.findByRole('dialog', { name: '止めた・戻した記録' }); await flush()
    expect(within(dialog).getByText('運用履歴を読み込めませんでした')).toBeTruthy()
    expect(within(dialog).queryByText('0回')).toBeNull()
    expect(within(dialog).queryByText('この期間の記録はありません')).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'CSVで書き出す' }) as HTMLButtonElement).disabled).toBe(true)
    historyFixture.failed = false
    historyFixture.data = [incident('retried', 1)]
    fireEvent.click(within(dialog).getByRole('button', { name: 'もう一度読み込む' }))
    expect(await within(dialog).findByText('理由-retried')).toBeTruthy()
    expect(summaryCard('止めた回数').getByText('1回')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'CSVで書き出す' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('現在の期間だけCSVへ出し、担当・対象・理由の式と引用符を無害化する', async () => {
    const recent = { ...incident('recent', 1), reason: '=式,"確認"', actorId: '@担当', lineAccountId: '+対象' }
    historyFixture.data = [recent, incident('old', 40)]
    let blob: NodeBlob | undefined
    vi.stubGlobal('Blob', NodeBlob)
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value as NodeBlob; return 'blob:operation-csv' })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<HistoryPanel />); await flush()
    fireEvent.click(screen.getByRole('button', { name: '履歴のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '止めた・戻した記録を見る' }))
    const dialog = await screen.findByRole('dialog', { name: '止めた・戻した記録' }); await flush()
    fireEvent.change(within(dialog).getByLabelText('表示期間'), { target: { value: '30days' } }); await flush()
    fireEvent.click(within(dialog).getByRole('button', { name: 'CSVで書き出す' }))
    await waitFor(() => expect(blob).toBeTruthy())
    const csv = await blob!.text()
    expect(csv).toContain("\"'@担当\"")
    expect(csv).toContain("\"'+対象\"")
    expect(csv).toContain("\"'=式,\"\"確認\"\"\"")
    expect(csv).toContain(recent.createdAt)
    expect(csv).not.toContain('理由-old')
    expect(csv.split('\n')).toHaveLength(2)
    expect(click.mock.instances[0].download).toBe('operation-history.csv')
    expect(revoke).toHaveBeenCalledWith('blob:operation-csv')
  })

})
