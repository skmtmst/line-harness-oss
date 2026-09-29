import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const appShell = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../components/app-shell.tsx'), 'utf8')

describe('スタッフ招待の確認画面', () => {
  it('URL断片を消してから参加ボタンでPOST契約を呼ぶ', () => {
    expect(source).toContain("params.get('invite')")
    expect(source).toContain('window.history.replaceState')
    expect(source).toContain('api.staff.acceptInvitation(token)')
    expect(source).toContain('参加する')
  })

  it('未ログインでも共通の認証ガードより手前で表示する', () => {
    expect(appShell).toContain('isPublicAuthPath(pathname)')
  })
})
