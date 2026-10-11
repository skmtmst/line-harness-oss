import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
const CSS = read('../../v8/automations/create/create.module.css')
const CHOICE = read('../../components/shared/radio-card.module.css')
const PAGE = read('../../v8/automations/create/create.tsx')
const ENTRY = read('new/page.tsx')
const TOKENS = read('../globals.css')

describe('automation 作成の現役の寸法と入口', () => {
  it('選ぶカードは共通のカードと現在のトークンを使う', () => {
    expect(PAGE).toContain('<RadioCard')
    expect(PAGE).toContain('className={styles.triggerCard}')
    expect(CSS).toMatch(/\.triggerCard\s*\{[^}]*min-height: var\(--tpl-cfl-target-h\)/s)
    expect(CHOICE).toContain('padding: var(--polish-space-card); gap: var(--polish-space-row);')
    expect(CHOICE).toContain('border-radius: var(--radius-card)')
    expect(TOKENS).toContain('--tpl-cfl-target-h: 98px')
  })

  it('行の操作は共通の高さ36・丸み10のトークンを使う', () => {
    expect(CSS).toMatch(/\.menuBox > button\.menuButton\s*\{[^}]*height: var\(--tpl-chip-h\)/s)
    expect(CSS).toMatch(/\.menuBox > button\.menuButton\s*\{[^}]*border-radius: var\(--radius-control\)/s)
    expect(TOKENS).toContain('--tpl-chip-h: 36px')
    expect(TOKENS).toContain('--radius-control: 10px')
  })

  it('旧の高さ40へ分岐する入口を残さない', () => {
    expect(ENTRY).toContain('<NewAutomationV8 chrome="create"')
    expect(ENTRY).not.toContain('useAdminTheme')
    expect(ENTRY).not.toContain('NewAutomationPageV7')
  })
})
