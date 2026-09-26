// @vitest-environment happy-dom
/*
 * 検査が止まっている時の帯（B-3）を本物の React で動かす試験。
 * 止まっている時だけ帯が出る。止まっていなければ何も出さない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
}))

const health = mocks.health

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      fileScan: {
        ...actual.api.fileScan,
        health: mocks.health,
      },
    },
  }
})

import FileScanStoppedBanner from './file-scan-stopped-banner'

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FileScanStoppedBanner', () => {
  test('止まっている時は帯が出る', async () => {
    health.mockResolvedValue({ success: true, data: { stopped: true, pendingCount: 2, oldestPendingAt: '2026-09-25T08:00:00+09:00' } })
    render(<FileScanStoppedBanner accountId="acc-1" />)
    await waitFor(() => {
      expect(screen.getByText(/ファイルの検査が止まっています/)).toBeTruthy()
    })
    // 赤は使わない。件数の重複も出さない。
    expect(document.body.innerHTML).not.toContain('text-danger')
  })

  test('止まっていなければ何も出ない', async () => {
    health.mockResolvedValue({ success: true, data: { stopped: false, pendingCount: 0, oldestPendingAt: null } })
    const { container } = render(<FileScanStoppedBanner accountId="acc-1" />)
    await waitFor(() => {
      expect(health).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe('')
  })
})
