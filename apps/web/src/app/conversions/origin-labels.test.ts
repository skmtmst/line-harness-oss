import { describe, expect, it } from 'vitest'
import { originInfoOf } from './origin-labels'
import { readExclusionView } from './conversion-exclusion'

/**
 * R41: 起点ごとの名前・対象・金額の説明は1つの対応表だけが持つ。
 * 作成・一覧・詳細・編集はここから引く。タグ起点で「注文」の言葉が
 * 出ないことを、代表の起点で固定する。
 */
describe('起点の説明の対応表(R41)', () => {
  it('6起点すべてに名前・対象・金額の説明がある', () => {
    for (const key of [
      'ec_order_confirmed',
      'form_submitted',
      'reservation_confirmed',
      'url_reach',
      'webinar_completed',
      'tag_added',
    ]) {
      const info = originInfoOf(key)
      expect(info.name).not.toBe('その他')
      expect(info.trigger).toBeTruthy()
      expect(info.targetLabel).toBeTruthy()
      expect(info.target).toBeTruthy()
      expect(info.amount).toBeTruthy()
    }
  })

  it('タグ起点の説明に注文・EC連携の言葉が出ない', () => {
    const info = originInfoOf('tag_added')
    expect(info.name).toBe('タグが付いた')
    for (const text of [info.trigger, info.targetLabel, info.target, info.amount]) {
      expect(text).not.toContain('注文')
      expect(text).not.toContain('EC連携')
    }
  })

  it('注文起点だけが注文金額の説明を持つ', () => {
    expect(originInfoOf('ec_order_confirmed').amount).toContain('注文の金額')
    for (const key of ['form_submitted', 'reservation_confirmed', 'webinar_completed', 'tag_added']) {
      expect(originInfoOf(key).amount).toContain('金額なし')
    }
  })

  it('知らない起点は空にせず「その他」で返す', () => {
    const info = originInfoOf('unknown_future_type')
    expect(info.name).toBe('その他')
    expect(info.trigger).toBeTruthy()
  })
})

/**
 * R40: 自由文のメモと実効する除外条件を分けて読む。
 * 旧 excludedCondition 文字列は条件に格上げしない。
 */
describe('除外条件の画面側の読み取り(R40)', () => {
  it('空・壊れた値は除外なし', () => {
    expect(readExclusionView(null).hasCondition).toBe(false)
    expect(readExclusionView({}).hasCondition).toBe(false)
    expect(readExclusionView({ exclusion: { operator: 'AND' } }).invalid).toBe(true)
  })

  it('旧文字列はメモとしてだけ読む', () => {
    const view = readExclusionView({ excludedCondition: 'テスト注文をのぞく' })
    expect(view.hasCondition).toBe(false)
    expect(view.memo).toBe('テスト注文をのぞく')
    expect(view.legacyMemo).toBe(true)
  })

  it('条件とメモを分けて読む', () => {
    const view = readExclusionView({
      exclusion: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
      exclusionMemo: '運用メモ',
    })
    expect(view.hasCondition).toBe(true)
    expect(view.ruleCount).toBe(1)
    expect(view.summary).toContain('タグ')
    expect(view.memo).toBe('運用メモ')
    expect(view.invalid).toBe(false)
  })
})
