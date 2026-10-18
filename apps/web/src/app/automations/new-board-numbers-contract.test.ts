import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
const ENTRY = read('new/page.tsx')

describe('automation 作成の現役の寸法と入口', () => {

  it('旧の高さ40へ分岐する入口を残さない', () => {
    expect(ENTRY).toContain('<NewAutomationV8 chrome="create"')
    expect(ENTRY).not.toContain('useAdminTheme')
    expect(ENTRY).not.toContain('NewAutomationPageV7')
  })
})
