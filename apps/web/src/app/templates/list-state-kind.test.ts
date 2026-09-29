import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  createBlockedReason,
  failureOf,
  failureOfResponse,
  listView,
  type TemplatesFailure,
} from './list-state-kind'

describe('テンプレート一覧の状態の言い分け', () => {
  it('権限不足を取得失敗に混ぜない', () => {
    // 読む人が次にすることが違う。403は権限を足せば見られる。
    expect(failureOf(new ApiError(403)).kind).toBe('forbidden')
    expect(failureOf(new ApiError(500)).kind).toBe('error')
    expect(failureOf(new TypeError('fetch failed')).kind).toBe('error')
    expect(failureOfResponse().kind).toBe('error')
  })

  it('決めた言葉づかいから外れない', () => {
    expect(failureOf(new ApiError(403)).title).toBe('見る権限がありません')
    expect(failureOf(new ApiError(500)).title).toBe('読み込めませんでした')
    expect(failureOfResponse().title).toBe('読み込めませんでした')
    // 内部の合図をそのまま画面へ出さない。
    expect(failureOf(new ApiError(500, 'templates_list_failed')).description).not.toMatch(
      /[a-z_]{4,}/,
    )
  })

  it('読込中・権限不足・取得失敗・初回空・0件を5つとも分ける', () => {
    const forbidden: TemplatesFailure = failureOf(new ApiError(403))
    const failed: TemplatesFailure = failureOf(new ApiError(500))

    expect(listView({ loading: true, failure: null, total: 0, matched: 0 })).toBe('loading')
    // 読み込み中は「まだ1件も無い」と言わない。0件のまま出ると消えたように見える。
    expect(listView({ loading: true, failure: failed, total: 3, matched: 0 })).toBe('loading')
    expect(listView({ loading: false, failure: forbidden, total: 0, matched: 0 })).toBe('forbidden')
    expect(listView({ loading: false, failure: failed, total: 0, matched: 0 })).toBe('error')
    expect(listView({ loading: false, failure: null, total: 0, matched: 0 })).toBe('empty')
    // 作ってあるのに絞り込みで0件。「まだありません」と混ぜない。
    expect(listView({ loading: false, failure: null, total: 12, matched: 0 })).toBe('no-match')
    expect(listView({ loading: false, failure: null, total: 12, matched: 3 })).toBe('ready')
  })

  it('読み込めていないあいだは作成を押させず、理由を言う', () => {
    expect(createBlockedReason({ loading: true, failure: null })).toBe('読み込んでいます')
    expect(createBlockedReason({ loading: false, failure: failureOf(new ApiError(403)) })).toBe(
      '操作する権限がありません',
    )
    expect(createBlockedReason({ loading: false, failure: failureOf(new ApiError(500)) })).toContain(
      '読み込めませんでした',
    )
    expect(createBlockedReason({ loading: false, failure: null })).toBeNull()
  })
})
