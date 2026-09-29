// @vitest-environment happy-dom
/*
 * R291: 停止前の確認リンクが、対象の成果や紹介リンクを開く。
 * قياس: 確認窓の「ここを開く」が対象紹介者つきの明細へ向くこと、承認側で
 * 紹介者絞りが効いて件数が一致し、絞りを外して戻れること。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  approvalsImpl: null as null | ((params: unknown) => Promise<unknown>),
}))

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      archiveImpact: async () => ({
        success: true,
        data: { activeLinks: 1, unsettledReward: 5000, pendingConversions: 2 },
      }),
      archive: async () => ({ success: true, data: {} }),
    },
    conversionApprovals: {
      list: (params: unknown) => fixture.approvalsImpl!(params),
    },
    lineAccounts: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const { AffiliateArchiveDialog } = await import('./action-dialogs')
const { ApprovalQueue } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

function approvalItem(eventId: string, affiliateId: string, affiliateName: string, friendName: string) {
  return {
    eventId,
    createdAt: '2026-09-10T00:00:00+09:00',
    friendId: `friend-${eventId}`,
    friendName,
    affiliateId,
    affiliateName,
    offerId: null,
    offerName: null,
    offerRewardMiles: null,
    conversionPointName: null,
    value: 1000,
    approvalStatus: 'pending',
    duplicateFlag: false,
    offerActionsIncomplete: false,
    lineAccountId: null,
    lineAccountName: null,
    orderNumber: null,
    orderStatus: null,
    sameOrderDuplicate: false,
    rewardAmount: null,
    rewardEntryStatus: null,
  }
}

describe('R291 停止前の確認は対象の明細を開く', () => {
  test('承認待ちとリンクの「ここを開く」は対象紹介者つきの明細へ向く', async () => {
    render(
      <AffiliateArchiveDialog
        target={{ id: 'aff-a', name: '候補A' }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )
    const links = await screen.findAllByRole('link', { name: 'ここを開く' })
    expect(links).toHaveLength(3)
    const hrefs = links.map((link) => (link as HTMLAnchorElement).getAttribute('href'))
    // 承認待ちは成果承認タブ＋対象紹介者。成果地点へ迷い込まない。
    expect(hrefs).toContain('/conversions?tab=approvals&affiliate=aff-a')
    // リンクは対象紹介者の内訳。案件一覧へ迷い込まない。
    expect(hrefs).toContain('/conversions?tab=affiliates&affiliate=aff-a')
    for (const href of hrefs) {
      expect(href ?? '').not.toBe('/conversions')
    }
  })

  test('成果承認は紹介者で絞られ、絞りを外して戻れる', async () => {
    fixture.approvalsImpl = async (params: unknown) => {
      const status = (params as { status: string }).status
      if (status !== 'pending') return { success: true, data: [] }
      return {
        success: true,
        data: [
          approvalItem('ev-a1', 'aff-a', '候補A', '田中'),
          approvalItem('ev-a2', 'aff-a', '候補A', '鈴木'),
          approvalItem('ev-b1', 'aff-b', '候補B', '佐藤'),
        ],
      }
    }
    render(<ApprovalQueue focusAffiliateId="aff-a" />)

    // 紹介者の札が出て、対象の2件だけが見える。
    await screen.findByText('紹介者：候補A')
    await waitFor(() => expect(screen.queryByText('田中')).not.toBeNull())
    expect(screen.queryByText('鈴木')).not.toBeNull()
    expect(screen.queryByText('佐藤')).toBeNull()

    // 札を押すと絞りが外れて、3件に戻れる。
    await act(async () => {
      fireEvent.click(screen.getByText('紹介者：候補A'))
    })
    await waitFor(() => expect(screen.queryByText('佐藤')).not.toBeNull())
    expect(screen.queryByText('田中')).not.toBeNull()
  })
})
