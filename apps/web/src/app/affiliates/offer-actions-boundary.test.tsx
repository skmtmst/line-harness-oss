// @vitest-environment happy-dom
/*
 * 案件フォームの候補境界と、承認時の案件動作の失敗表示(N-212)。
 *
 * 実物の React をマウントして操作する。ソース文字列の検査では次が固定できない。
 *   - 編集モーダルのタグ・シナリオ候補が「選んだLINEアカウントの有効なもの」
 *     だけに絞られること（別アカウント・停止済みは出ない）
 *   - 古い不正参照が残っている案件では、候補から外れた選択値が
 *     「このアカウントでは使えません」と表示されて消えないこと
 *   - アカウントを切り替えると候補が付け替わること
 *   - 保存がサーバーに止められたとき、その文言がそのまま出ること
 *   - 承認時の動作が未完なら、画面は「承認できた」とは言わず理由を出すこと
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  approveImpl: null as null | ((eventId: string, expected: string) => Promise<unknown>),
  listImpl: null as null | ((params?: unknown) => Promise<unknown>),
  offersImpl: null as null | (() => Promise<unknown>),
  offerUpdateImpl: null as null | ((id: string, body: unknown) => Promise<unknown>),
  offerUpdateCalls: [] as unknown[],
  accountsImpl: null as null | (() => Promise<unknown>),
  tagsImpl: null as null | (() => Promise<unknown>),
  scenariosImpl: null as null | (() => Promise<unknown>),
}))

vi.mock('@/lib/api', () => ({
  api: {
    conversionApprovals: {
      list: (params?: unknown) => fixture.listImpl!(params),
      approve: (eventId: string, expected: string) => fixture.approveImpl!(eventId, expected),
      reject: vi.fn(),
      bulkDecide: vi.fn(),
    },
    affiliateOffers: {
      list: () => fixture.offersImpl!(),
      update: (id: string, body: unknown) => {
        fixture.offerUpdateCalls.push(body)
        return fixture.offerUpdateImpl!(id, body)
      },
      create: vi.fn(),
    },
    lineAccounts: { list: () => fixture.accountsImpl!() },
    tags: { list: () => fixture.tagsImpl!() },
    scenarios: { list: () => fixture.scenariosImpl!() },
  },
}))

const { ApprovalQueue, OffersTab } = await import('./tabs')

function approvalItem(eventId: string, friendName: string) {
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

const offer = {
  id: 'off-1',
  name: '案件A',
  description: null,
  rewardAmount: 1000,
  rewardMiles: null,
  lineAccountId: 'acc-1',
  // 古い不正参照: acc-1 の案件に acc-2 のタグ・停止したシナリオが残っている。
  tagId: 'tag-b',
  scenarioId: 'scn-off',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  fixture.offerUpdateCalls = []
  fixture.listImpl = async (params?: unknown) => {
    const status = (params as { status?: string } | undefined)?.status
    return status === 'pending'
      ? { success: true, data: [approvalItem('ev-1', '利用者1')] }
      : { success: true, data: [] }
  }
  fixture.approveImpl = async () => ({ success: true, data: {} })
  fixture.offersImpl = async () => ({ success: true, data: [offer] })
  fixture.offerUpdateImpl = async () => ({ success: true, data: offer })
  fixture.accountsImpl = async () => ({
    success: true,
    data: [
      { id: 'acc-1', name: 'アカウントA' },
      { id: 'acc-2', name: 'アカウントB' },
    ],
  })
  fixture.tagsImpl = async () => ({
    success: true,
    data: [
      { id: 'tag-a', name: 'タグA', lineAccountId: 'acc-1', status: 'active' },
      { id: 'tag-old', name: 'タグ旧', lineAccountId: 'acc-1', status: 'archived' },
      { id: 'tag-b', name: 'タグB', lineAccountId: 'acc-2', status: 'active' },
    ],
  })
  fixture.scenariosImpl = async () => ({
    success: true,
    data: [
      { id: 'scn-a', name: 'シナリオA', lineAccountId: 'acc-1', isActive: true },
      { id: 'scn-off', name: 'シナリオ停止', lineAccountId: 'acc-1', isActive: false },
      { id: 'scn-b', name: 'シナリオB', lineAccountId: 'acc-2', isActive: true },
    ],
  })
})

afterEach(() => {
  cleanup()
})

async function openOfferEdit() {
  render(<OffersTab />)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
  })
  const title = await screen.findByText('案件を編集')
  const modal = title.closest('div.fixed')
  expect(modal).toBeTruthy()
  return within(modal as HTMLElement)
}

function selectOptions(select: HTMLSelectElement) {
  return Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent ?? '' }))
}

describe('案件編集の候補境界', () => {
  test('タグ・シナリオの候補は選択中アカウントの有効なものだけ。古い参照は印つきで残る', async () => {
    const modal = await openOfferEdit()
    const selects = modal.getAllByRole('combobox') as HTMLSelectElement[]
    // [アカウント, タグ, シナリオ]
    const [, tagSelect, scenarioSelect] = selects

    const tagOptions = selectOptions(tagSelect)
    expect(tagOptions.map((o) => o.text)).toEqual([
      '— 選択しない —',
      'タグA',
      'タグB（このアカウントでは使えません）',
    ])
    // 他アカウントのtag-bは選ばせないが、いま選ばれている値としては見せる。
    expect(tagSelect.value).toBe('tag-b')

    const scenarioOptions = selectOptions(scenarioSelect)
    expect(scenarioOptions.map((o) => o.text)).toEqual([
      '— 選択しない —',
      'シナリオA',
      'シナリオ停止（このアカウントでは使えません）',
    ])
    expect(scenarioSelect.value).toBe('scn-off')
  })

  test('アカウントを切り替えると候補が付け替わる', async () => {
    const modal = await openOfferEdit()
    const [accountSelect, tagSelect, scenarioSelect] = modal.getAllByRole('combobox') as HTMLSelectElement[]

    await act(async () => {
      fireEvent.change(accountSelect, { target: { value: 'acc-2' } })
    })

    // acc-2 ではタグBだけが候補になる。選ばれている値も acc-2 側で有効なので
    // そのまま残り、「使えません」表示は消える。
    const texts = selectOptions(tagSelect).map((o) => o.text)
    expect(texts).toContain('タグB')
    expect(texts).not.toContain('タグA')
    // acc-2 では tag-b は有効なので「使えません」表示は消える。
    expect(texts.every((t) => !t.includes('使えません'))).toBe(true)

    const scenarioTexts = selectOptions(scenarioSelect).map((o) => o.text)
    expect(scenarioTexts).toContain('シナリオB')
    expect(scenarioTexts).not.toContain('シナリオA')
    // scn-off は acc-1 側の停止中シナリオ。acc-2 では候補外なので印つきで残る。
    expect(scenarioTexts).toContain('シナリオ停止（このアカウントでは使えません）')
  })

  test('サーバーが止めた保存は、その文言をそのまま出す', async () => {
    fixture.offerUpdateImpl = async () => ({
      success: false,
      error: '選んだタグはこのアカウントのものではありません',
    })
    const modal = await openOfferEdit()
    await act(async () => {
      fireEvent.click(modal.getByRole('button', { name: '更新' }))
    })
    await waitFor(() => {
      expect(modal.getByText('選んだタグはこのアカウントのものではありません')).toBeTruthy()
    })
  })
})

describe('承認時の案件動作が未完のとき', () => {
  test('「承認できた」とは言わず、未完の理由を画面に出す', async () => {
    const reason =
      '成果は承認されましたが、案件の動作（タグ付与）を完了できませんでした。もう一度送ると完了していない分だけやり直します。'
    // サーバーは 422 + error 本文を返す。fetchApi は非2xxを例外にするので、
    // 画面には ApiError の message（= 本文の文言）が届く。
    fixture.approveImpl = async () => {
      throw new Error(reason)
    }

    render(<ApprovalQueue />)
    await waitFor(() => {
      expect(screen.getByLabelText('利用者1の成果を選ぶ')).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '認める' }))
    })
    await waitFor(() => {
      expect(screen.getByText(reason)).toBeTruthy()
    })
    // 成功扱いの表示が出ていないこと。
    expect(screen.queryByText(/承認しました|承認できました/)).toBeNull()
  })
})
