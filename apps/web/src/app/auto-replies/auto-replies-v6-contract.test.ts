import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')

describe('V6 自動応答一覧 q8wSqO', () => {
  it('失敗時は4つの数を実値0として表示しない', () => {
    expect(page).toContain('data-design-node="q8wSqO"')
    expect(page).toContain("import Notice from '@/components/shared/notice'")
    expect(page).toContain('<Notice tone="error" message={error}')
    expect(page).toContain('const listAvailable = !loading && !error')
    expect(page).toContain('<KpiValue value={listAvailable ? items.length : null} unit="件" />')
    expect(page).toContain('<KpiValue value={monthlyHits} unit="回" />')
    expect(page).toContain('<KpiValue value={timeRestrictedCount} unit="件" />')
    expect(page).toContain('<KpiValue value={neverHitCount} unit="件" />')
    expect(page).toContain("value === null ? '—'")
  })

  it('前のアカウントの値を失敗後に残さない', () => {
    expect(page.indexOf('setItems([])')).toBeLessThan(page.indexOf('api.autoReplies.list'))
    expect(page).toContain('自動応答を読み込めませんでした。時間をおいて再読み込みしてください。')
    expect(page).toContain("error ? 'いまは読み込めていません。上の案内をご覧ください。'")
    expect(page).toContain("data-list-state={loading ? 'loading' : error ? 'error'")
  })

  it('一部のヒット数が未取得なら不完全な合計を出さない', () => {
    expect(page).toContain('items.every((r) => r.hits !== undefined)')
    expect(page).toContain("if (savedFilter === 'never') return r.hits?.total === 0")
    expect(page).toContain("{r.hits?.period ?? '—'}")
    expect(page).toContain("（累計 {r.hits?.total ?? '—'}）")
  })

  it('内部の値を利用者向けの言葉へ置き換える', () => {
    for (const label of [
      '何もしない',
      'カード',
      'カルーセル',
      '位置情報',
      '動画',
      '音声',
      'スタンプ',
      '画像',
      '文章',
      'この画面で設定',
      '返信内容',
      '設定済みの処理',
    ]) {
      expect(page).toContain(label)
    }
    for (const internalLabel of [
      'silent rule のみ',
      'line_account_id が別アカに固定',
      'automation rule 未登録',
      '返信あり (inline)',
      '>template<',
    ]) {
      expect(page).not.toContain(internalLabel)
    }
  })

  it('名前を引けないときも内部IDを表示しない', () => {
    expect(page).toContain('アカウント名を確認できません')
    expect(page).toContain('名前を確認できません')
    expect(page).not.toContain('r.lineAccountId.slice')
    expect(page).not.toContain('r.templateId.slice')
  })
})
