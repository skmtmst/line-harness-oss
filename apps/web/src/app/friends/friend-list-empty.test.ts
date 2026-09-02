import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyMessageOf, hasAnyFilter, type EmptyFilters } from './friend-list-empty'

const none: EmptyFilters = { search: '', tagId: '', advanced: false, others: false }

describe('0件の言い分け', () => {
  it('絞り込んで0件のときだけ「条件」を言う', () => {
    for (const filters of [
      { ...none, search: 'たなか' },
      { ...none, tagId: 'tag-1' },
      { ...none, advanced: true },
      { ...none, others: true },
    ]) {
      expect(hasAnyFilter(filters)).toBe(true)
      expect(emptyMessageOf(filters).title).toBe('条件に合う友だちが見つかりません')
    }
  })

  it('外すべき条件が無いときに「条件を外せ」と言わない', () => {
    /*
      まだ誰も友だちになっていないアカウントで「検索条件を外すか」と
      言われても、外す条件が無い。
    */
    const message = emptyMessageOf(none)
    expect(hasAnyFilter(none)).toBe(false)
    expect(message.title).toBe('まだ友だちがいません')
    expect(message.description).not.toContain('条件')
    expect(message.description).not.toContain('絞り込み')
  })

  it('1人もいないときは次にやることを書く', () => {
    // 友だちは管理画面からは増やせない。増やし方を指す。
    expect(emptyMessageOf(none).description).toContain('流入と計測')
  })

  it('空白だけの検索は絞り込みに数えない', () => {
    expect(hasAnyFilter({ ...none, search: '   ' })).toBe(false)
  })
})

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

describe('URLから来る絞り込み', () => {
  it('画面が点数の帯と配信対象を数に入れている', () => {
    /*
      **考え方が正しくても、画面が渡していなければ効かない。**
      渡し忘れを見張る（別の画面で、宣言だけを見ていたために描画を
      消しても試験が通ったことがある）。
    */
    expect(PAGE).toContain('|| hasScoreRange')
    expect(PAGE).toContain("|| audienceId !== ''")
    expect(PAGE).toContain('<ListState kind="empty"')
  })

  it('点数の帯や配信対象で開いたときも絞り込みとして数える', () => {
    /*
      行動スコアの「この帯の人を見る」は `?scoreMin=` で開く。
      数え落とすと、その帯に誰もいないときに「まだ友だちがいません」と出て、
      絞り込んだ結果だと分からなくなる。
    */
    expect(emptyMessageOf({ ...none, others: true }).title).toBe('条件に合う友だちが見つかりません')
  })
})
