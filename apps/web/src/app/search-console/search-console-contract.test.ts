import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('Search Console画面のタブ表記', () => {
  it('Search ConsoleをGoogle Analyticsと呼ばない（画面の表記）', () => {
    expect(PAGE).not.toContain(`label: 'Google Analytics'`)
    expect(PAGE).not.toContain('>Google Analytics<')
  })

  it('行き来するタブに正しい名前を出す', () => {
    expect(PAGE).toContain(`label: 'Search Console'`)
  })
})
