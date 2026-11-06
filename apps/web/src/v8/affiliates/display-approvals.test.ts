/*
 * 承認の全件読み（display.ts の listAllConversionApprovals）の重なりの扱い（WEB003）。
 * 同じアカウント・状態・位置で走っている読み込みは1本にまとめ、アカウントが違えば分ける。
 * 終わった結果は持ち越さず、fresh は走っている読み込みを使わない（承認・却下の後の読み直し）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, conversionApprovals: { ...actual.api.conversionApprovals, list } } }
})

import { listAllConversionApprovals } from './display'

let waiting: Array<() => void> = []
const release = () => { waiting.forEach((resolve) => resolve()); waiting = [] }
beforeEach(() => {
  waiting = []
  list.mockReset().mockImplementation(() => new Promise((resolve) => {
    waiting.push(() => resolve({ success: true, data: [] }))
  }))
})

describe('承認の全件読みの重なり（WEB003）', () => {
  it('同じ条件で走っている読み込みは1本にまとめる', async () => {
    const first = listAllConversionApprovals('pending', 0, { accountId: 'acc-a' })
    const second = listAllConversionApprovals('pending', 0, { accountId: 'acc-a' })
    expect(list).toHaveBeenCalledTimes(1)
    release()
    expect(await second).toEqual(await first)
  })

  it('アカウントが違えば別に読み、終わった結果は持ち越さない', async () => {
    const a = listAllConversionApprovals('pending', 0, { accountId: 'acc-a' })
    listAllConversionApprovals('pending', 0, { accountId: 'acc-b' })
    expect(list).toHaveBeenCalledTimes(2)
    list.mockResolvedValue({ success: true, data: [] })
    release()
    await a
    await Promise.resolve()
    await listAllConversionApprovals('pending', 0, { accountId: 'acc-a' })
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('fresh は走っている読み込みを使わずに読み直す', async () => {
    listAllConversionApprovals('approved', 0, { accountId: 'acc-c' })
    listAllConversionApprovals('approved', 0, { accountId: 'acc-c', fresh: true })
    expect(list).toHaveBeenCalledTimes(2)
  })
})
