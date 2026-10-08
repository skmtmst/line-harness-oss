import { describe, expect, it } from 'vitest'
// @ts-expect-error JS fixture
import { ACCESS_USERS, accessUser } from './fixtures.mjs'

describe('ROOT-17 操作履歴がない人の見本', () => {
  it('明示したnullを既定の日時で埋めない', () => {
    const viewer = ACCESS_USERS.items.find((row: { id: string }) => row.id === 'stf-tax')
    expect(viewer.lastActionAt).toBeNull()
    expect(viewer.lastLoginAt).toBe('2026-09-01T03:20:00.000Z')
  })
  it('ログイン履歴もnullを残し、未指定と区別する', () => {
    expect(accessUser('id', 'name', 'view_only', 'active', { lastLoginAt: null, lastActionAt: null })).toMatchObject({ lastLoginAt: null, lastActionAt: null })
    expect(accessUser('id', 'name', 'view_only', 'active')).toMatchObject({ lastLoginAt: '2026-09-06T23:02:00.000Z', lastActionAt: '2026-09-07T00:18:00.000Z' })
  })
  it('指定しなかった日時には既定値を残す', () => {
    const user = ACCESS_USERS.items.find((row: { id: string }) => row.id === 'access-user-9')
    expect(user.lastActionAt).toBeNull() // 招待中は既定も未取得
    expect(ACCESS_USERS.items.find((row: { id: string }) => row.id === 'stf-3').lastActionAt).toBeTruthy()
  })
})
