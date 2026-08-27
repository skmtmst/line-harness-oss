import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 機能20 分析', () => {
  it('V6の8タブと実Nodeを維持する', () => {
    for (const tab of [
      '友だちの増減', '配信の反応', '経路と成果', '使われ方',
      'クロス分析', 'ファネル', 'URLクリック', '保存した分析',
    ]) expect(PAGE).toContain(`label: '${tab}'`)

    for (const node of ['Zxezb', 'J6Inc', 'YBGtm', 'QQ1SR', 'Fh2Qj', 'dfwD4']) {
      expect(PAGE).toContain(`data-design-node="${node}"`)
    }
  })

  it('既存の5つの読取APIを再利用し、本文タイトルを重ねない', () => {
    for (const path of [
      '/api/analytics/friends', '/api/analytics/reactions', '/api/analytics/routes',
      '/api/analytics/usage', '/api/analytics/url-clicks',
    ]) expect(API).toContain(path)
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('Google Analytics')
    expect(PAGE).toContain('Search Consoleを見る')
  })

  it('未取得の数値を0にせず、保存機能の未接続を明示する', () => {
    expect(PAGE).toContain("if (value.value === null) return '—'")
    expect(PAGE).toContain('保存した分析はまだ接続されていません')
    expect(PAGE).not.toContain('定義版と結果スナップショットが無くても')
  })
})
