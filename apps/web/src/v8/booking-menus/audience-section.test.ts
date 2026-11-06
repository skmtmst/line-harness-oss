/*
 * 予約メニューの「見せる相手」（板 L6ifay・B9）。見える・見えないの判定と理由の文を守る。
 *  - 全員なら見える。タグ条件の未選択は保存できない。
 *  - 「タグが付いた人だけ」：どれか1つ付いていれば見える。無ければ見えない（タグ名つきの理由）。
 *  - 「付いた人には見せない」：どれか1つ付いていれば見えない。
 */
import { describe, expect, it } from 'vitest'
import { audienceVisibility } from './audience-section'

const name = (id: string) => ({ member: '会員', ng: '無断2回' } as Record<string, string>)[id] ?? id

describe('audienceVisibility', () => {
  it('全員なら見え、タグ条件の未選択には直し方を出す', () => {
    expect(audienceVisibility('all', ['member'], [], name)).toEqual({ visible: true })
    for (const mode of ['include_tags', 'exclude_tags'] as const) expect(audienceVisibility(mode, [], [], name)).toEqual({ visible: false, reason: '見せる相手のタグを1つ以上選んでください。' })
  })
  it('タグが付いた人だけ：付いていれば見え、無ければ理由つきで見えない', () => {
    expect(audienceVisibility('include_tags', ['member'], ['member'], name)).toEqual({ visible: true })
    expect(audienceVisibility('include_tags', ['member'], ['vip'], name)).toEqual({ visible: false, reason: 'タグ「会員」がありません' })
  })
  it('どれか1つでよい（複数のタグ）', () => {
    expect(audienceVisibility('include_tags', ['member', 'vip'], ['vip'], name)).toEqual({ visible: true })
  })
  it('タグが付いた人には見せない', () => {
    expect(audienceVisibility('exclude_tags', ['ng'], ['ng'], name)).toEqual({ visible: false, reason: 'タグ「無断2回」が付いています' })
    expect(audienceVisibility('exclude_tags', ['ng'], [], name)).toEqual({ visible: true })
  })
})
