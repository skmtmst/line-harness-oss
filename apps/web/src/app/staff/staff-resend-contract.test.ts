import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const staffSource = readFileSync(join(directory, 'page.tsx'), 'utf8')

describe('V6 30 招待の再送(N-425/N-432 #668)', () => {
  it('招待中タブから再送口を叩く', () => {
    // lib/api.ts は触らない。fetchApi を直接使って CSRF と Cookie を付ける。
    expect(staffSource).toContain('fetchApi')
    expect(staffSource).toContain('/resend-invitation')
    expect(staffSource).toContain("method: 'POST'")
  })

  it('二重押しを受け付けない', () => {
    expect(staffSource).toContain('resendingId')
    expect(staffSource).toContain('disabled={resendingId !== null}')
    expect(staffSource).toContain('送信中')
  })

  it('行に期限を出し、結果と次の対応を帯に出す', () => {
    expect(staffSource).toContain('inviteExpiresAt')
    expect(staffSource).toContain('招待の期限')
    expect(staffSource).toContain('送り直しました')
    expect(staffSource).toContain('role="status"')
    expect(staffSource).toContain('role="alert"')
  })

  it('再送ボタンは管理者だけ・未受諾だけに出す', () => {
    expect(staffSource).toContain("tab === 'invited' && administrator && member && member.inviteStatus !== 'active'")
  })
})
