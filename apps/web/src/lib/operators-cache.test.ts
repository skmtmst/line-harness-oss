// @vitest-environment happy-dom
/*
 * 画面を移るたびに取り直していた /api/operators を、タブ内で使い回す。
 * 友だち一覧の絞り込みと友だち詳細の対応編集が、同じ名簿を共有する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ api: { operators: { list } } }))

import { clearOperatorsCache, loadOperators } from './operators-cache'

const ok = { success: true as const, data: [{ id: 'op-1', name: '担当A' }] }

describe('担当者名簿の共有', () => {
  beforeEach(() => {
    clearOperatorsCache()
    list.mockReset()
    list.mockResolvedValue(ok)
  })
  afterEach(() => vi.restoreAllMocks())

  it('同時に来た要求は1本にまとめ、同じ答えを返す', async () => {
    const [a, b] = await Promise.all([loadOperators(), loadOperators()])
    expect(list).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('30秒のあいだは取り直さない（画面を移っても呼ばない）', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadOperators()
    now += 29_000
    await loadOperators()
    expect(list).toHaveBeenCalledTimes(1)
    now += 2_000
    await loadOperators()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('失敗は覚えず、次は取り直す', async () => {
    list.mockResolvedValueOnce({ success: false, error: 'x' })
    await loadOperators()
    await loadOperators()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('ログアウト・セッション切れで捨てたら、次は取り直す', async () => {
    await loadOperators()
    clearOperatorsCache()
    await loadOperators()
    expect(list).toHaveBeenCalledTimes(2)
  })
})
