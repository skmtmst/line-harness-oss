// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAuditCounts } from './use-audit-counts'

const { audit } = vi.hoisted(() => ({ audit: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { ops: { audit } } }))
vi.mock('@/components/ops/ops-ui', () => ({ opsCall: async (response: Promise<unknown>) => response }))
const filters = [{ key: 'members', actions: 'member.invite' }]
afterEach(() => { cleanup(); audit.mockReset() })

it('全件数はAPIのtotalを使い、0件も残し、期間条件をそろえる', async () => {
  audit.mockImplementation(async (params: { action?: string }) => ({ success: true, data: [], total: params.action ? 0 : 123 }))
  const view = renderHook(() => useAuditCounts('2026-10-01', '2026-10-22', filters))
  await waitFor(() => expect(view.result.current).toEqual({ '': 123, members: 0 }))
  expect(audit).toHaveBeenCalledWith({ action: 'member.invite', from: '2026-10-01', to: '2026-10-22T23:59:59', limit: 1, offset: 0 })
})

it('期間変更後に古い件数を出さず、遅れて返った応答も捨てる', async () => {
  let resolveOld!: (response: unknown) => void
  const old = new Promise(resolve => { resolveOld = resolve })
  audit.mockImplementation((params: { from?: string }) => params.from === '2026-10-01' ? old : Promise.resolve({ success: false }))
  const view = renderHook(({ from }) => useAuditCounts(from, '', filters), { initialProps: { from: '2026-10-01' } })
  view.rerender({ from: '2026-10-02' })
  expect(view.result.current).toEqual({})
  await act(async () => resolveOld({ success: true, total: 999, data: [] }))
  expect(view.result.current).toEqual({})
})
