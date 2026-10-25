import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
const ENTRY = read('new/page.tsx')

describe('automation 作成の現役の寸法と入口', () => {

  it('作成の入口はV8本体に直結し、旧テーマの選択口を残さない', () => {
    expect(ENTRY).toContain('<NewAutomationV8 chrome="create"')
    expect(ENTRY).not.toContain('useAdminTheme')
    expect(ENTRY).not.toContain('NewAutomationPageV7')
  })
})
