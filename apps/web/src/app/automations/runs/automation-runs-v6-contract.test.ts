import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 25-1-B オートメーションが動いた記録', () => {
  it('実Node IDと共通部品を使い、本文タイトルを重ねない', () => {
    expect(PAGE).toContain('data-design-node="DkPY0"')
    expect(PAGE).toContain('<Tabs')
    expect(PAGE).toContain('<SummaryCard')
    expect(PAGE).toContain('<DataTable>')
    expect(PAGE).toContain('<ListState')
    expect(PAGE).toContain('<Pagination')
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })

  it('通常・読込・空・失敗を分け、条件外と失敗を混ぜない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain("skipped: { label: '動きませんでした'")
    expect(PAGE).toContain("failed: { label: '失敗しました'")
  })

  it('未取得を0にせず、固定の設計件数を埋め込まない', () => {
    expect(PAGE).toContain("chip.count === null ? '—'")
    expect(PAGE).toContain("item.friendName ?? '対象は未取得'")
    expect(PAGE).toContain("summary ? (hasFailures ? '理由を確認してください' : '失敗はありません') : '集計を取得できません'")
    expect(PAGE).not.toContain('8,420')
    expect(PAGE).not.toContain('1,240')
    expect(PAGE).not.toContain('9,660')
  })

  it('既存APIクライアントから実行記録を取得し、安全な再実行を装わない', () => {
    expect(API).toContain('/api/automation-runs')
    expect(PAGE).toContain('api.automations.runs')
    expect(PAGE).not.toContain('もう一度やる')
    expect(PAGE).not.toContain('API error:')
  })
})
