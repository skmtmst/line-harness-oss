import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
/*
 * 2026-10-07：分析タブの定義（analytics-tabs.ts）は Search Console 画面が使わなくなった
 * （どこからも読まれない）ので消した。タブ定義の名前を見ていた行は外し、画面の表記だけを見る。
 */

describe('Search Console画面のタブ表記', () => {
  it('Search ConsoleをGoogle Analyticsと呼ばない（画面の表記）', () => {
    expect(PAGE).not.toContain(`label: 'Google Analytics'`)
    expect(PAGE).not.toContain('>Google Analytics<')
  })
})
