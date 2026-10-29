// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tenant = vi.hoisted(() => ({ me: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { tenants: { me: tenant.me } } }))
vi.mock('@/lib/api/transport/read-cache', () => ({ invalidateApiReads: tenant.invalidate }))

import { publishTenantName, useTenantName } from './use-tenant-name'

afterEach(() => vi.clearAllMocks())

describe('統括名の表示', () => {
  it('統括の情報と同じ API から名前を読み、保存時はすぐ更新する', async () => {
    tenant.me.mockResolvedValue({ success: true, data: { name: 'Shed Products株式会社' } })
    const { result, unmount } = renderHook(() => useTenantName())
    expect(result.current).toBe('統括')
    await waitFor(() => expect(result.current).toBe('Shed Products株式会社'))

    act(() => publishTenantName('新しい統括名'))
    expect(result.current).toBe('新しい統括名')
    expect(tenant.invalidate).toHaveBeenCalledWith('/api/tenants/me')
    unmount()
  })

  it('取得失敗時に LINE アカウント名へ置き換えない', async () => {
    tenant.me.mockRejectedValue(new Error('network'))
    const { result, unmount } = renderHook(() => useTenantName())
    await waitFor(() => expect(tenant.me).toHaveBeenCalled())
    expect(result.current).toBe('統括')
    unmount()
  })
})
