import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../../components/app-shell.tsx', import.meta.url), 'utf8')
const hq = readFileSync(new URL('../../hq/page.tsx', import.meta.url), 'utf8')
const oldWizard = readFileSync(new URL('../../restaurant-test/stores/new/page.tsx', import.meta.url), 'utf8')
const manualLinks = readFileSync(new URL('../../../lib/manual-links.ts', import.meta.url), 'utf8')

describe('店舗アカウント追加フロー', () => {
  it('枠なしの6画面を履歴を積まず切り替える', () => {
    expect(shell).toContain("pathname.startsWith('/stores/new')")
    expect(shell).toContain('<AuthGuard><AccountProvider>{children}</AccountProvider></AuthGuard>')
    for (const step of ['choose', 'create', 'api', 'credentials', 'verify', 'done']) expect(page).toContain(`'${step}'`)
    expect(page).toContain('router.replace(`/stores/new?step=${next}`)')
    expect(page).not.toContain('next/link')
  })

  it('新規を選んだ場合だけ作成手順へ進む', () => {
    expect(page).toContain("choice === 'new' ? 'create' : 'api'")
    expect(page).toContain("step === 'create'")
  })

  it('空のマニュアルURLは押せない案内を表示する', () => {
    expect(page).toContain('aria-disabled="true"')
    expect(page).toContain('マニュアルは準備中です')
    for (const key of ['chooseLineAccount', 'createOfficialAccount', 'chooseProvider', 'enableMessagingApi', 'findChannelCredentials', 'createLoginChannel', 'createLiffApp', 'friendImport']) {
      expect(manualLinks).toContain(`${key}: ''`)
    }
  })

  it('統括の2つの導線だけを新画面へ向け、旧画面を残す', () => {
    expect(hq.match(/href="\/stores\/new"/g)).toHaveLength(2)
    expect(oldWizard).toContain('NewRestaurantStorePage')
  })
})
