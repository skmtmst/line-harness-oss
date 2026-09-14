// @vitest-environment happy-dom
/*
 * 成果承認キューの一括確認・結果表示(N-213)。
 *
 * 実物の React をマウントして操作する。ソース文字列の検査では次が固定できない。
 *   - 押す前に確認が出て、並んだ顔ぶれが実行対象と一致すること（確認なし即実行の抑止）
 *   - 確認前には保存 request が1本も出ないこと
 *   - 結果が成功/競合/拒否/失敗に分かれて出て、途中失敗を全成功と表示しないこと
 *   - 残りの選び直し再試行ができること
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listImpl: null as null | ((params?: unknown) => Promise<unknown>),
  bulkDecideImpl: null as null | ((items: unknown) => Promise<unknown>),
  bulkDecideCalls: [] as unknown[],
}))

vi.mock('@/lib/api', () => ({
  api: {
    conversionApprovals: {
      list: (params?: unknown) => fixture.listImpl!(params),
      approve: vi.fn(),
      reject: vi.fn(),
      bulkDecide: (items: unknown) => {
        fixture.bulkDecideCalls.push(items)
        return fixture.bulkDecideImpl!(items)
      },
    },
  },
}))

const { ApprovalQueue } = await import('./tabs')

function item(eventId: string, friendName: string) {
  return {
    eventId,
    createdAt: '2026-09-01T10:00:00.000+09:00',
    friendId: `fr-${eventId}`,
    friendName,
    affiliateId: 'aff-1',
    affiliateName: '紹介者1',
    offerId: 'off-1',
    offerName: '案件A',
    offerRewardMiles: null,
    conversionPointName: '購入',
    value: 1000,
    approvalStatus: 'pending',
    duplicateFlag: false,
  }
}

beforeEach(() => {
  fixture.bulkDecideCalls = []
  let decided = false
  fixture.listImpl = async (params?: unknown) => {
    const status = (params as { status?: string } | undefined)?.status
    if (status === 'pending') {
      // 一括の実行後はev-1だけ承認ずみとして返す（読み直し後の最新状態）。
      return {
        success: true,
        data: decided
          ? [item('ev-2', '利用者2')]
          : [item('ev-1', '利用者1'), item('ev-2', '利用者2')],
      }
    }
    if (status === 'approved') {
      return { success: true, data: decided ? [{ ...item('ev-1', '利用者1'), approvalStatus: 'approved' }] : [] }
    }
    return { success: true, data: [] }
  }
  fixture.bulkDecideImpl = async () => {
    decided = true
    return {
      success: true,
      data: {
        succeeded: ['ev-1'],
        conflicted: [{ id: 'ev-2', currentStatus: 'approved' }],
        denied: [],
        failed: [],
      },
    }
  }
})

afterEach(() => {
  cleanup()
})

async function openBulkConfirm() {
  render(<ApprovalQueue />)
  await waitFor(() => {
    expect(screen.getByLabelText('利用者1の成果を選ぶ')).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByLabelText('利用者1の成果を選ぶ'))
    fireEvent.click(screen.getByLabelText('利用者2の成果を選ぶ'))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '選んだ2件をまとめて認める' }))
  })
}

describe('一括承認の確認と結果表示', () => {
  test('確認に出る顔ぶれが実行対象と一致し、確認前はrequestが出ない', async () => {
    await openBulkConfirm()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('利用者1／紹介者1／案件A')).toBeTruthy()
    expect(within(dialog).getByText('利用者2／紹介者1／案件A')).toBeTruthy()
    expect(fixture.bulkDecideCalls).toHaveLength(0)
  })

  test('キャンセルではrequestが出ず、確定で1本だけ出る', async () => {
    await openBulkConfirm()
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    })
    expect(fixture.bulkDecideCalls).toHaveLength(0)
    // 開き直して確定する。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '選んだ2件をまとめて認める' }))
    })
    const reopened = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(reopened).getByRole('button', { name: 'まとめて認める' }))
    })
    expect(fixture.bulkDecideCalls).toHaveLength(1)
    expect(fixture.bulkDecideCalls[0]).toEqual([
      { id: 'ev-1', status: 'approved', expectedStatus: 'pending' },
      { id: 'ev-2', status: 'approved', expectedStatus: 'pending' },
    ])
  })

  test('結果は成功と競合に分かれ、全成功とは表示しない', async () => {
    await openBulkConfirm()
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'まとめて認める' }))
    })
    const result = await screen.findByRole('status')
    expect(within(result).getByText(/成功 1件/)).toBeTruthy()
    expect(within(result).getByText(/ほかの人が先に判断 1件/)).toBeTruthy()
    expect(within(result).getByText(/先に判断されました：利用者2/)).toBeTruthy()
    expect(within(result).queryByText(/全.*成功/)).toBeNull()
  })

  test('残りの選び直し再試行ができる', async () => {
    await openBulkConfirm()
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'まとめて認める' }))
    })
    const result = await screen.findByRole('status')
    // 再試行では競合で状態が変わった利用者2だけが選ばれ直す。
    await act(async () => {
      fireEvent.click(within(result).getByRole('button', { name: '残りを選び直して再試行' }))
    })
    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).queryByText('利用者1／紹介者1／案件A')).toBeNull()
    expect(within(reopened).getByText('利用者2／紹介者1／案件A')).toBeTruthy()
  })
})
