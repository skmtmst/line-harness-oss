import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('./google-business.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../../lib/restaurant-google-api.ts', import.meta.url), 'utf8')

describe('Googleビジネス V6正本契約', () => {
  it('V6正本の設定ノード・一体型パネル・680px接続カードを使う', () => {
    expect(page).toContain('data-design-node={tab === \'settings\' ? \'p9ALPi\' : \'lM0zP\'}')
    expect(page).toContain('style={{ minHeight: 58 }}')
    expect(page).toContain('style={{ maxWidth: 680 }}')
    expect(page).toContain('Googleアカウントを接続')
    expect(page).toContain('接続する店舗は、1つのLINEアカウントにつき1店舗です。')
    expect(page).toContain('tabIndex={item.current ? 0 : -1}')
    expect(page).toContain("key !== 'ArrowRight'")
  })

  it('表示用の役割名ではなくAPIの権限判定で接続ボタンを制御する', () => {
    expect(api).toContain('permissions: { canManageConnection: boolean; canPublishReply: boolean }')
    expect(page).toContain('data.permissions.canManageConnection')
    expect(page).not.toContain('api.staff.me()')
    expect(page).toContain('disabled={busy || !canManage || !data.oauthConfigured}')
  })
})
