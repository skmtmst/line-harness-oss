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
  approveImpl: null as null | ((eventId: string, expectedStatus: string) => Promise<unknown>),
  approveCalls: [] as Array<{ eventId: string; expectedStatus: string }>,
  bulkDecideCalls: [] as unknown[],
}))

vi.mock('@/lib/api', () => ({
  api: {
    conversionApprovals: {
      list: (params?: unknown) => fixture.listImpl!(params),
      approve: (eventId: string, expectedStatus: string) => {
        fixture.approveCalls.push({ eventId, expectedStatus })
        return fixture.approveImpl!(eventId, expectedStatus)
      },
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
    offerActionsIncomplete: false,
  }
}

beforeEach(() => {
  fixture.bulkDecideCalls = []
  fixture.approveCalls = []
  fixture.approveImpl = async () => ({ success: true, data: { id: 'x', approvalStatus: 'approved' } })
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

/*
 * 付帯動作のやり直し(N-212)。
 * 承認は済んでいて案件のタグ付与・シナリオ開始だけ未完の行に
 * 「付帯動作をやり直す」を出す。押下は既存の承認PATCHの already_set
 * 経路を使い、成功したら一覧を読み直す。
 */
describe('付帯動作のやり直し', () => {
  function useApprovedList(flagged: { current: boolean }) {
    fixture.listImpl = async (params?: unknown) => {
      const status = (params as { status?: string } | undefined)?.status
      if (status === 'approved') {
        return {
          success: true,
          data: [
            { ...item('ev-1', '利用者1'), approvalStatus: 'approved', offerActionsIncomplete: flagged.current },
            { ...item('ev-2', '利用者2'), approvalStatus: 'approved', offerActionsIncomplete: false },
          ],
        }
      }
      return { success: true, data: [] }
    }
  }

  async function openApprovedTab() {
    render(<ApprovalQueue />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /認めた/ })).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /認めた/ }))
    })
  }

  test('未完の行にだけボタンが出て、クリックで既存approveが呼ばれ、成功後に再読込で消える', async () => {
    const flagged = { current: true }
    useApprovedList(flagged)
    fixture.approveImpl = async () => {
      flagged.current = false
      return { success: true, data: { id: 'ev-1', approvalStatus: 'approved' } }
    }

    await openApprovedTab()
    // flag が立った行にだけ出る（ev-2 には出ない）。
    const retry = await screen.findByRole('button', { name: '付帯動作をやり直す' })
    expect(screen.getAllByRole('button', { name: '付帯動作をやり直す' })).toHaveLength(1)

    await act(async () => {
      fireEvent.click(retry)
    })
    expect(fixture.approveCalls).toEqual([{ eventId: 'ev-1', expectedStatus: 'approved' }])
    // 成功で読み直し → flag が下りると列ごと消える。
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '付帯動作をやり直す' })).toBeNull()
    })
  })

  test('失敗は一覧のエラー領域に理由が出る', async () => {
    useApprovedList({ current: true })
    fixture.approveImpl = async () => {
      throw new Error('タグ付与後の処理が残っています')
    }

    await openApprovedTab()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '付帯動作をやり直す' }))
    })
    await waitFor(() => {
      expect(screen.getByText('タグ付与後の処理が残っています')).toBeTruthy()
    })
  })

  test('実行中はボタンが無効になり二重にrequestが出ない', async () => {
    useApprovedList({ current: true })
    let resolveApprove!: (value: unknown) => void
    fixture.approveImpl = () => new Promise((resolve) => { resolveApprove = resolve })

    await openApprovedTab()
    const retry = await screen.findByRole('button', { name: '付帯動作をやり直す' })
    fireEvent.click(retry)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '付帯動作をやり直す' })).toHaveProperty('disabled', true)
    })
    fireEvent.click(screen.getByRole('button', { name: '付帯動作をやり直す' }))
    expect(fixture.approveCalls).toHaveLength(1)
    await act(async () => {
      resolveApprove({ success: true, data: { id: 'ev-1', approvalStatus: 'approved' } })
    })
  })

  test('未承認・却下タブにはボタンを出さない', async () => {
    // 既定のlistImpl（pending 2件・approved/rejected 0件）のまま。
    render(<ApprovalQueue />)
    await waitFor(() => {
      expect(screen.getByLabelText('利用者1の成果を選ぶ')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '付帯動作をやり直す' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /却下した/ }))
    })
    await waitFor(() => {
      expect(screen.getByText('条件に合う成果がありません')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '付帯動作をやり直す' })).toBeNull()
  })
})
