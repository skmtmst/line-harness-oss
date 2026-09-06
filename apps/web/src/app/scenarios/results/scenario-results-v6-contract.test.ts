import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('../detail/scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 5-1-L シナリオ配信結果', () => {
  it('実Node IDとシナリオ・統計・開始記録APIを使う', () => {
    expect(PAGE).toContain('data-design-node="M2b2B"')
    expect(PAGE).toContain('api.scenarios.get(id)')
    expect(PAGE).toContain('api.scenarios.stats(id)')
    expect(PAGE).toContain('api.scenarios.runs(id, selectedAccountId, { limit: 50 })')
    expect(DETAIL).toContain('href={`/scenarios/results?id=${id}`}')
  })

  it('読込・失敗・配信内容なしを分ける', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('onRetry={() => void load()}')
  })

  it('取れない開封・クリック・失敗数を0として作らない', () => {
    expect(PAGE).toContain("run?.opened.value ?? '—'")
    expect(PAGE).toContain("run?.clicked.value ?? '—'")
    expect(PAGE).toContain('runs?.steps[0]?.failed.reason')
    expect(PAGE).toContain('<div><dt>エラー</dt><dd>—</dd></div>')
    expect(PAGE).toContain('LINEでは通ごとの開封・クリック・失敗をすべて取得できません')
    expect(PAGE).toContain('run?.delivered ?? result?.reachedCount')
    expect(PAGE).not.toContain('result?.reachedCount ?? 0')
    expect(PAGE).not.toContain('82.4%')
    expect(PAGE).not.toContain('46.1%')
  })

  it('本文タイトルを重ねず、CSVと編集への戻りを備える', () => {
    expect(PAGE).toContain('usePageTitle(')
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
    expect(PAGE).toContain('CSVで書き出す')
    expect(PAGE).toContain('シナリオ編集へ戻る')
  })
})
