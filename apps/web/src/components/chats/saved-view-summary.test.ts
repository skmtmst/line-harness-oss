import { describe, expect, it } from 'vitest'
import {
  normalizeSavedViewConditions,
  savedViewSummary,
  type SavedViewConditions,
} from './saved-view-summary'

const OPERATORS = [{ id: 'op-1', name: 'Kenta' }, { id: 'op-2', name: 'Masato' }]
const base: SavedViewConditions = {
  query: '', channels: [], statuses: [], assignees: [],
  unread: 'all', messageTypes: [], receivedFrom: null, receivedTo: null,
}

describe('保存した検索の中身', () => {
  it('何も絞っていなければ「すべての会話」と言う', () => {
    // 空文字を返すと、名前の下に何も無い行ができて「読み込み中」に見える。
    expect(savedViewSummary(base, OPERATORS)).toBe('すべての会話')
  })

  it('対応マーク・担当・受信経路を日本語で並べる', () => {
    const summary = savedViewSummary(
      { ...base, statuses: ['unread', 'on_hold'], assignees: ['op-1'], channels: ['line'] },
      OPERATORS,
    )
    expect(summary).toBe('未対応・保留 ／ 担当 Kenta ／ LINE')
  })

  it('担当者のidをそのまま出さない', () => {
    const summary = savedViewSummary({ ...base, assignees: ['op-9'] }, OPERATORS)
    expect(summary).toBe('担当 不明な担当者')
    expect(summary).not.toContain('op-9')
  })

  it('未割り当てを担当者名と同じ扱いで出す', () => {
    expect(savedViewSummary({ ...base, assignees: ['unassigned'] }, OPERATORS))
      .toBe('担当 未割り当て')
  })

  it('自分の未読だけ・名前で検索・受信期間も出す', () => {
    const summary = savedViewSummary(
      { ...base, unread: 'mine', query: '請求', receivedFrom: '2026-08-01', receivedTo: '2026-08-31' },
      OPERATORS,
    )
    expect(summary).toContain('自分の未読だけ')
    expect(summary).toContain('受信 2026-08-01〜2026-08-31')
    expect(summary).toContain('「請求」を含む')
  })

  it('内部の記号を出さない', () => {
    const summary = savedViewSummary(
      { ...base, statuses: ['in_progress', 'resolved'], channels: ['email'], messageTypes: ['text', 'image'] },
      OPERATORS,
    )
    expect(summary).not.toMatch(/[a-z_]{3,}/)
    expect(summary).toContain('対応中・完了')
    expect(summary).toContain('メール')
    expect(summary).toContain('種別 2件')
  })
})

describe('古い形の保存を読み込む', () => {
  it('受信箱より前の形でも落ちない', () => {
    /*
     * Workerは `conditions` を `JSON.parse(...) as unknown` でそのまま返す。
     * 保存した検索は受信箱より前からあり、古い行は `{ all: [], any: [] }`。
     * 決めつけて `statuses.length` を読むと、開いた瞬間に受信箱ごと落ちる
     * （実際に撮影で落ちた）。
     */
    const old = normalizeSavedViewConditions({ all: [], any: [] })
    expect(old.statuses).toEqual([])
    expect(savedViewSummary(old, OPERATORS)).toBe('すべての会話')
  })

  it('null・文字列・配列を渡されても落ちない', () => {
    for (const value of [null, undefined, 'こわれた', 42, []]) {
      expect(() => savedViewSummary(normalizeSavedViewConditions(value), OPERATORS)).not.toThrow()
    }
  })

  it('知らない値は捨てて、知っている値だけ残す', () => {
    const mixed = normalizeSavedViewConditions({
      statuses: ['unread', 'とても未読', 7],
      channels: ['line', 'fax'],
      assignees: ['op-1', null],
      unread: 'そのうち',
      query: 12,
    })
    expect(mixed.statuses).toEqual(['unread'])
    expect(mixed.channels).toEqual(['line'])
    expect(mixed.assignees).toEqual(['op-1'])
    expect(mixed.unread).toBe('all')
    expect(mixed.query).toBe('')
  })
})
