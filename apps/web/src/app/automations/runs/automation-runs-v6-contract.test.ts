import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 オートメーションが動いた記録（DkPY0）', () => {
  it('実ノードと既存の実行記録APIを結ぶ', () => {
    expect(PAGE).toContain('data-design-node="DkPY0"')
    expect(PAGE).toContain('/api/automation-runs?')
    expect(PAGE).toContain("params.set('lineAccountId', selectedAccountId)")
    expect(PAGE).toContain("params.set('search', query.trim())")
    expect(PAGE).toContain("params.set('status', resultFilter)")
  })

  it('設計の4指標・検索・絞り込み・列を持つ', () => {
    for (const word of [
      'この30日に動いた',
      'いちばん動いた',
      '失敗した',
      '条件に外れて動かなかった',
      '友だちの名前・オートメーションの名前で検索',
      'いつ・だれに',
      'したこと',
      'かかった時間',
    ]) expect(PAGE).toContain(word)
  })

  it('読込・空・絞込0件・失敗を区別する', () => {
    expect(PAGE).toContain("'loading' | 'ready' | 'error'")
    expect(PAGE).toContain('動いた記録を読み込んでいます')
    expect(PAGE).toContain('動いた記録はまだありません')
    expect(PAGE).toContain('条件に合う記録はありません')
    expect(PAGE).toContain('動いた記録を読み込めませんでした')
  })

  it('詳細を開き、失敗した処理だけを安全な再実行口へ接続する', () => {
    expect(PAGE).toContain('もう一度やる')
    expect(PAGE).toContain('/api/automation-runs/${encodeURIComponent(run.id)}/retry')
    expect(PAGE).toContain('成功済みの処理は二重に実行しません')
    expect(PAGE).toContain('失敗した処理をもう一度やる')
    expect(PAGE).toContain('CSV書き出しは未接続')
    expect(PAGE).toContain('<Button disabled>CSVで書き出す</Button>')
    expect(PAGE).toContain('setSelectedRun(run)')
    expect(PAGE).toContain('実行記録の中身')
    expect(PAGE).toContain('成功済みの処理を二重に動かさないため')
  })

  it('壊れた応答を描画せず取得失敗へ倒す', () => {
    expect(PAGE).toContain('!response.data.summary')
    expect(PAGE).toContain('!Array.isArray(response.data.items)')
    expect(PAGE).toContain('実行記録の応答形式が正しくありません')
  })

  it('検索の連打で古い応答が新しい表示を上書きしない (#580)', () => {
    expect(PAGE).toContain('loadGeneration.current')
    expect(PAGE).toContain('generation !== loadGeneration.current')
    expect(PAGE).toContain('setTimeout(() => void load(), 400)')
  })

  it('変えられない表示条件は選択肢に見せない (#580)', () => {
    expect(PAGE).toContain('この30日・20件表示')
    expect(PAGE).not.toContain('onChange={() => undefined}')
  })
})
