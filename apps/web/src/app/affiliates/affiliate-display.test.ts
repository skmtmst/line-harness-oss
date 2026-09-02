import { describe, expect, it } from 'vitest'
import {
  CLICK_SUMMARY_LABEL,
  DUPLICATE_FLAG_TITLE,
  LINK_CODE_HEADING,
  NAME_UNAVAILABLE,
  duplicateFlagHeading,
  duplicateFriendNameText,
  personNameText,
} from './affiliate-display'

describe('成果・アフィリエイトの言葉づかい', () => {
  it('名前が取れないときにIDの断片を出さない', () => {
    expect(personNameText('山田 太郎')).toBe('山田 太郎')
    expect(personNameText(null)).toBe(NAME_UNAVAILABLE)
    expect(personNameText(undefined)).toBe(NAME_UNAVAILABLE)
    // 空白だけの名前は「取れた」ことにしない。
    expect(personNameText('   ')).toBe(NAME_UNAVAILABLE)
    expect(NAME_UNAVAILABLE).toBe('名前を取得できませんでした')
  })

  it('見出しにデータベースの語を混ぜない', () => {
    for (const label of [CLICK_SUMMARY_LABEL, LINK_CODE_HEADING, DUPLICATE_FLAG_TITLE]) {
      expect(label).not.toMatch(/ref_tracking|ref_code|identity_key/i)
    }
    expect(CLICK_SUMMARY_LABEL).toBe('クリック')
    expect(LINK_CODE_HEADING).toBe('リンクコード')
    expect(DUPLICATE_FLAG_TITLE).toBe('同じ友だちの重複')
  })

  it('重複の見出しは件数を実値で書く', () => {
    expect(duplicateFlagHeading(1)).toBe('同じ友だちの重複（1件）')
    expect(duplicateFlagHeading(1200)).toBe('同じ友だちの重複（1,200件）')
    expect(duplicateFlagHeading(1)).not.toMatch(/identity_key/i)
  })

  it('重複の札は読み込み済みの名前から引き、引けなければ作らない', () => {
    const people = [
      { friendId: 'friend-4aaaaaaa', displayName: '山田 太郎' },
      { friendId: 'friend-5bbbbbbb', displayName: null },
    ]
    expect(duplicateFriendNameText('friend-4aaaaaaa', people)).toBe('山田 太郎')
    expect(duplicateFriendNameText('friend-5bbbbbbb', people)).toBe(NAME_UNAVAILABLE)
    // まだ読み込んでいないページの友だち。IDを代わりに出さない。
    expect(duplicateFriendNameText('friend-9zzzzzzz', people)).toBe(NAME_UNAVAILABLE)
    expect(duplicateFriendNameText('friend-9zzzzzzz', people)).not.toContain('friend-9')
  })
})
