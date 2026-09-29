// @vitest-environment happy-dom
/*
 * 監査 R389・R391（解除の競合・保管履歴）の画面回帰試験。
 * 本物の MergedPersonDetailView を react-dom で動かし、api の成否だけを差し替える。
 *
 * - R389: 解除で409が返ったら、解除の窓を閉じて最新を読み直す。
 *   古い結び付きと窓を残さない。
 * - R391: 権限不足の面にも「一覧へ戻る」を残す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      mergedPeople: {
        ...actual.api.mergedPeople,
        get: calls.get,
        unlink: calls.unlink,
        updateDeliveryPriorities: vi.fn(),
        updateProfileValues: vi.fn(),
      },
    },
  }
})

const { ApiError } = await import('@/lib/api')
import MergedPersonDetailView from './merged-person-detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function personFixture(revision: number, linked: boolean) {
  return {
    success: true,
    data: {
      id: 'user-a', status: 'active', revision, primaryDisplayName: '田中 花子',
      linkedFriends: linked
        ? [{
          friendId: 'friend-a', displayName: '田中 花子', lineAccountId: 'account-a',
          lineAccountName: '本店', isFollowing: true, linkedAt: '2026-08-30T09:00:00.000Z',
          linkMethod: 'operator_review', confidence: 92, candidateId: 'candidate-a', candidateVersion: 2,
        }]
        : [],
      profileValues: [], deliveryPriorities: [],
      history: [
        { id: 'event-1', eventType: 'unlink', summary: '統合ユーザーから友だちを解除しました', actorName: '担当B', occurredAt: '2026-08-30T10:00:00.000Z' },
      ],
      profileCandidates: [], tagCandidates: [],
      createdAt: '2026-08-30T09:00:00.000Z', updatedAt: '2026-08-30T10:00:00.000Z', archivedAt: null,
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  calls.get.mockReset()
  calls.unlink.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function renderView(onClose: () => void) {
  await act(async () => {
    root.render(<MergedPersonDetailView personId="user-a" onClose={onClose} />)
  })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

function buttonByText(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
  if (!found) throw new Error(`button "${text}" not found`)
  return found
}

describe('R389 解除の競合は窓を閉じて読み直す', () => {
  it('409の後は古い結び付きの窓を残さず、成功した解除だけが残る', async () => {
    calls.get
      .mockResolvedValueOnce(personFixture(1, true))
      .mockResolvedValue(personFixture(2, false))
    calls.unlink.mockRejectedValue(new ApiError(409, '別の人が先に変更しました'))
    const onClose = vi.fn()
    await renderView(onClose)
    await flush()
    fireEvent.click(buttonByText('統合を解除'))
    await flush()
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')
    if (!dialog) throw new Error('unlink dialog not open')
    const textarea = dialog.querySelector('textarea')
    if (!textarea) throw new Error('reason field not found')
    fireEvent.change(textarea, { target: { value: '確認した根拠を書きます' } })
    fireEvent.click(buttonByText('結び付けを解除', dialog))
    await flush()
    // 解除の窓は閉じ、競合の文と読み直した中身が出る。
    expect(document.body.textContent).not.toContain('確認した根拠を書いてください')
    expect(document.body.textContent).toContain('別の人が先に変更しました')
    expect(calls.get).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain('friend-a')
  })
})

describe('R391 権限不足でも一覧へ戻れる', () => {
  it('forbidden の面に「一覧へ戻る」がある', async () => {
    calls.get.mockRejectedValue(new ApiError(403, 'この統合ユーザーを表示する権限がありません'))
    const onClose = vi.fn()
    await renderView(onClose)
    await flush()
    expect(document.body.textContent).toContain('権限')
    fireEvent.click(buttonByText('一覧へ戻る'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
