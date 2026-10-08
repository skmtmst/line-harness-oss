import { describe, expect, it } from 'vitest'

import { canManageSupportMarkByRole } from './support-mark-permissions'

/*
 * R511: 対応マークの作成・編集は owner・admin だけが案内される。
 * staff はタグの権限キーを持っていても作れない
 * （サーバの requireRole('owner', 'admin') と同じ条件）。
 */
describe('R511 対応マークの操作可否', () => {
  it('owner と admin は作れる', () => {
    expect(canManageSupportMarkByRole('owner')).toBe(true)
    expect(canManageSupportMarkByRole('admin')).toBe(true)
  })

  it('staff は作れない', () => {
    expect(canManageSupportMarkByRole('staff')).toBe(false)
  })

  it('不明・未設定は分からない（案内は出したままにし、サーバが決める）', () => {
    expect(canManageSupportMarkByRole('')).toBeNull()
    expect(canManageSupportMarkByRole(null)).toBeNull()
  })
})
