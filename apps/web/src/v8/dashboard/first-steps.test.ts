import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * はじめにやること（修正案 D-3）の判定の口。
 * 今ある口の答えから6つの「済み」を決める。読めなかった口は null（＝カードを出さない）。
 */
const api = vi.hoisted(() => ({
  gettingStarted: { get: vi.fn() },
  friendAddRules: { list: vi.fn() },
  richMenuGroups: { listPage: vi.fn() },
  broadcasts: { list: vi.fn() },
  scenarios: { listPage: vi.fn() },
  staff: { list: vi.fn() },
}))
vi.mock('@/lib/api', () => ({ api }))

import { loadFirstStepFacts } from './first-steps'

function allDone() {
  api.gettingStarted.get.mockResolvedValue({ success: true, data: { steps: [{ key: 'accounts', state: 'done' }] } })
  api.friendAddRules.list.mockResolvedValue({ success: true, data: { items: [{ status: 'published' }] } })
  api.richMenuGroups.listPage.mockResolvedValue({ success: true, data: { items: [], facets: { published: 2 } } })
  api.broadcasts.list.mockResolvedValue({ success: true, data: [{ status: 'sent' }] })
  api.scenarios.listPage.mockResolvedValue({ success: true, data: { items: [{ isActive: true }] } })
  api.staff.list.mockResolvedValue({ success: true, data: [{ id: 'a' }, { id: 'b' }] })
}

describe('はじめにやることの判定', () => {
  beforeEach(() => { vi.clearAllMocks(); allDone() })

  it('6つとも今ある口の答えで済みになる', async () => {
    expect(await loadFirstStepFacts('acc')).toEqual({ connect: true, greeting: true, richMenu: true, broadcast: true, scenario: true, invite: true })
    expect(api.friendAddRules.list).toHaveBeenCalledWith('acc', 'first_time', { status: 'published', limit: 1 })
    expect(api.broadcasts.list).toHaveBeenCalledWith({ accountId: 'acc', displayStatus: 'sent', limit: 1 })
    expect(api.scenarios.listPage).toHaveBeenCalledWith({ accountId: 'acc', active: 1, limit: 1 })
  })

  it('まだのものは false', async () => {
    api.gettingStarted.get.mockResolvedValue({ success: true, data: { steps: [{ key: 'accounts', state: 'stalled' }] } })
    api.friendAddRules.list.mockResolvedValue({ success: true, data: { items: [] } })
    api.richMenuGroups.listPage.mockResolvedValue({ success: true, data: { items: [], facets: { published: 0 } } })
    api.broadcasts.list.mockResolvedValue({ success: true, data: [] })
    api.scenarios.listPage.mockResolvedValue({ success: true, data: { items: [] } })
    api.staff.list.mockResolvedValue({ success: true, data: [{ id: 'me' }] })
    expect(await loadFirstStepFacts('acc')).toEqual({ connect: false, greeting: false, richMenu: false, broadcast: false, scenario: false, invite: false })
  })

  it('読めなかった口は null（判定できない）', async () => {
    api.broadcasts.list.mockRejectedValue(new Error('network'))
    api.staff.list.mockResolvedValue({ success: false, error: 'Forbidden' })
    const facts = await loadFirstStepFacts('acc')
    expect(facts.broadcast).toBeNull()
    expect(facts.invite).toBeNull()
    expect(facts.connect).toBe(true)
  })
})
