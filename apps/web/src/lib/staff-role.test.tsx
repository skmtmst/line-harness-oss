// @vitest-environment happy-dom
/*
 * 見るだけの担当者に変更の操作を出さない（共通の出し分け）。
 *
 * 境目はサーバの `requireRole('owner', 'admin')` と同じ。owner・admin だけが
 * 作る・変える・止める・消す・実行する。staff は読み取りだけ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const staffMe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
    },
  }
})

import { canManageRole, useStaffRole } from './staff-role'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('canManageRole（役割×操作の表）', () => {
  it.each([
    // [役割, 変更してよいか] — サーバの requireRole('owner', 'admin') と同じ。
    ['owner', true],
    ['admin', true],
    ['staff', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['viewer', false],
  ])('役割 %s → 変更%s', (role, expected) => {
    expect(canManageRole(role as string | null | undefined)).toBe(expected)
  })
})

describe('useStaffRole', () => {
  let host: HTMLDivElement
  let root: Root
  let seen: Array<string | null>

  function Probe() {
    seen.push(useStaffRole())
    return null
  }

  beforeEach(() => {
    seen = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function flush() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  it('staff.me の役割を返す（staff は見るだけ）', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'staff' } }))
    await act(async () => {
      root.render(<Probe />)
    })
    await flush()
    expect(seen[0]).toBeNull()
    expect(seen[seen.length - 1]).toBe('staff')
    expect(canManageRole(seen[seen.length - 1])).toBe(false)
  })

  it('owner は変更してよい', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
    await act(async () => {
      root.render(<Probe />)
    })
    await flush()
    expect(seen[seen.length - 1]).toBe('owner')
    expect(canManageRole(seen[seen.length - 1])).toBe(true)
  })

  it('読めなかったときは null のまま（呼び出し側は今までどおり出す）', async () => {
    staffMe.mockImplementation(async () => ({ success: false, error: 'ng' }))
    await act(async () => {
      root.render(<Probe />)
    })
    await flush()
    expect(seen[seen.length - 1]).toBeNull()
  })
})
