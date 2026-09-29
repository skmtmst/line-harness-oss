// @vitest-environment happy-dom
/*
 * R289: 紹介者を切り替えた後、遅い応答で別人の集計・リンク・友だち履歴に
 * 置き換わらない。実物の React を開き、Aの取得を保留→Bを開いて応答→Aの
 * 応答を返す順で、開いているBの情報が残ることを確かめる。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  gates: new Map<string, Array<(value: unknown) => void>>(),
  calls: [] as Array<string>,
}))

function gate(key: string): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const list = fixture.gates.get(key) ?? []
    list.push(resolve)
    fixture.gates.set(key, list)
  })
}

function resolveGate(key: string, value: unknown) {
  const list = fixture.gates.get(key) ?? []
  fixture.gates.set(key, [])
  for (const resolve of list) resolve(value)
}

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: async () => ({
        success: true,
        data: [
          { id: 'aff-a', name: '候補A', code: 'CODE_A', commissionRate: 10, isActive: true, createdAt: '2026-09-01T00:00:00+09:00', friendId: null },
          { id: 'aff-b', name: '候補B', code: 'CODE_B', commissionRate: 10, isActive: true, createdAt: '2026-09-02T00:00:00+09:00', friendId: null },
        ],
      }),
      allReport: async () => ({ success: true, data: [] }),
      reportV2: (id: string) => {
        fixture.calls.push(`report:${id}`)
        return gate(`report:${id}`)
      },
      links: (id: string) => {
        fixture.calls.push(`links:${id}`)
        return gate(`links:${id}`)
      },
      journeys: (id: string) => {
        fixture.calls.push(`journeys:${id}`)
        return gate(`journeys:${id}`)
      },
    },
    accountSettings: {
      getLinkBaseUrl: async () => ({ success: true, data: null }),
    },
    conversionApprovals: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const { AffiliatorsTab } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function reportFor(id: string, tag: string, clicks: number) {
  return {
    success: true,
    data: {
      affiliateId: id,
      affiliateName: tag,
      code: tag,
      commissionRate: 10,
      clicks,
      linkClicks: clicks,
      friendAdds: 1,
      conversions: 2,
      conversionsPending: 0,
      conversionsApproved: 2,
      conversionsRejected: 0,
      conversionsByPoint: [],
      revenue: 100,
      estimatedCommission: 10,
      confirmedReward: 10,
      byOffer: [],
      duplicateFlags: [],
    },
  }
}

function linksFor(id: string, refCode: string) {
  return {
    success: true,
    data: [
      {
        id: `link-${id}`,
        affiliate_id: id,
        ref_code: refCode,
        label: null,
        line_account_id: null,
        is_active: 1,
        created_at: '2026-09-01T00:00:00+09:00',
        click_count: 5,
        offer_id: null,
        offer_name: null,
      },
    ],
  }
}

function journeysFor(refCode: string, friendId: string, displayName: string) {
  return {
    success: true,
    data: [
      {
        friendId,
        displayName,
        addedAt: '2026-09-01T00:00:00+09:00',
        refCode,
        touchCount: 1,
        formCount: 0,
        conversionCount: 1,
        lastEventAt: '2026-09-02T00:00:00+09:00',
      },
    ],
    nextCursor: null,
  }
}

beforeEach(() => {
  fixture.gates.clear()
  fixture.calls.length = 0
})

afterEach(() => {
  cleanup()
})

async function openRow(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `${name}の成果を見る` }))
}

describe('R289 遅い詳細応答は選んでいる途中の紹介者へ混ぜない', () => {
  test('A→B選択、B→A応答でもBの情報を維持する', async () => {
    render(<AffiliatorsTab accountId={null} />)
    await screen.findByText('候補A')
    await screen.findByText('候補B')

    // Aの取得を保留したまま、Bを開く。
    await openRow('候補A')
    await openRow('候補B')

    // Bの応答だけ先に返す。
    await act(async () => {
      resolveGate('report:aff-b', reportFor('aff-b', '候補B', 222))
      resolveGate('links:aff-b', linksFor('aff-b', 'LINK_B'))
      resolveGate('journeys:aff-b', journeysFor('LINK_B', 'friend-b', 'Friend_B'))
    })
    // LINK_B はリンク表と動線表の2か所に出る。
    await waitFor(() => expect(screen.queryAllByText('LINK_B')).toHaveLength(2))
    expect(screen.queryByText('Friend_B')).not.toBeNull()

    // 遅れてAの応答が届いても、Bの表示は変わらない。
    await act(async () => {
      resolveGate('report:aff-a', reportFor('aff-a', '候補A', 111))
      resolveGate('links:aff-a', linksFor('aff-a', 'LINK_A'))
      resolveGate('journeys:aff-a', journeysFor('LINK_A', 'friend-a', 'Friend_A'))
    })
    await act(async () => {})

    expect(screen.queryAllByText('LINK_B')).toHaveLength(2)
    expect(screen.queryByText('Friend_B')).not.toBeNull()
    expect(screen.queryByText('LINK_A')).toBeNull()
    expect(screen.queryByText('Friend_A')).toBeNull()
    expect(screen.queryByText('222')).not.toBeNull()
    expect(screen.queryByText('111')).toBeNull()
  })

  test('閉じた後の応答は捨てる', async () => {
    render(<AffiliatorsTab accountId={null} />)
    await screen.findByText('候補A')

    await openRow('候補A')
    // 閉じる。
    fireEvent.click(screen.getByRole('button', { name: '候補Aの成果を閉じる' }))

    // 閉じた後にAの応答が届いても、何も出ない。
    await act(async () => {
      resolveGate('report:aff-a', reportFor('aff-a', '候補A', 111))
      resolveGate('links:aff-a', linksFor('aff-a', 'LINK_A'))
      resolveGate('journeys:aff-a', journeysFor('LINK_A', 'friend-a', 'Friend_A'))
    })
    await act(async () => {})

    expect(screen.queryByText('LINK_A')).toBeNull()
    expect(screen.queryByText('Friend_A')).toBeNull()
    // 一覧は残る。
    expect(screen.queryByText('候補A')).not.toBeNull()
    expect(screen.queryByText('候補B')).not.toBeNull()
  })
})
