/*
 * 使っている所が0のタグを窓なしで保管するとき、5秒たって送る直前の判定。
 * その間に使われ始めていたら保管しない・保管が断られたら失敗を返す。
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { archiveIfStillUnused } from './tags-tab'

const unusedImpact = {
  tag: { id: 'tag-1', name: '未使用', version: 3, status: 'active' as const },
  friendCount: 0,
  references: [],
  linkedActions: [],
  pendingRunCount: 0,
  blockingReferenceCount: 0,
  canArchive: true,
  revision: 'rev-1',
}

function tagsApi(impact: Record<string, unknown>, archiveResult: { success: boolean; error?: string } = { success: true }) {
  return {
    dependencies: vi.fn().mockResolvedValue({ success: true, data: { ...unusedImpact, ...impact } }),
    archive: vi.fn().mockResolvedValue(archiveResult),
  }
}

describe('archiveIfStillUnused', () => {
  it('まだ使われていなければ、読み直した版と影響の印を付けて保管する', async () => {
    const api = tagsApi({})
    const res = await archiveIfStillUnused('tag-1', 'acc-1', api as never)
    expect(res).toEqual({ success: true })
    expect(api.archive).toHaveBeenCalledWith('tag-1', 'acc-1', { expectedVersion: 3, impactRevision: 'rev-1' }, expect.any(String))
  })

  it.each([
    ['友だちに付いた', { friendCount: 1 }],
    ['どこかで使われ始めた', { references: [{ kind: 'scenario', name: 'A', href: '/', count: 1, state: 'active', definitionVersion: null }] }],
    ['連動の操作が付いた', { linkedActions: [{ kind: 'common_action', name: 'B', version: 1, state: 'published' }] }],
    ['実行待ちがある', { pendingRunCount: 1 }],
    ['止める参照がある', { blockingReferenceCount: 1 }],
    ['サーバーが保管できないと言う', { canArchive: false }],
  ])('%sなら保管しない', async (_label, impact) => {
    const api = tagsApi(impact)
    const res = await archiveIfStillUnused('tag-1', 'acc-1', api as never)
    expect(res.success).toBe(false)
    expect(api.archive).not.toHaveBeenCalled()
  })

  it('影響が読めなければ保管しない', async () => {
    const api = tagsApi({})
    api.dependencies.mockResolvedValue({ success: false, error: 'down' })
    const res = await archiveIfStillUnused('tag-1', 'acc-1', api as never)
    expect(res).toEqual({ success: false, error: 'down' })
    expect(api.archive).not.toHaveBeenCalled()
  })

  it('保管が断られたら失敗を返す（行を戻せるように）', async () => {
    const api = tagsApi({}, { success: false, error: 'version_conflict' })
    const res = await archiveIfStillUnused('tag-1', 'acc-1', api as never)
    expect(res).toEqual({ success: false, error: 'version_conflict' })
  })
})
