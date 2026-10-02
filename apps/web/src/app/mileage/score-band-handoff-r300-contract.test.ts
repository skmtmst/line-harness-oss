import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCORE_TAB = readFileSync(join(HERE, 'action-score-tab.tsx'), 'utf8')
const FRIENDS_PAGE = readFileSync(join(HERE, '..', 'friends', 'page.tsx'), 'utf8')
const BROADCAST_NEW = readFileSync(join(HERE, '..', 'broadcasts', 'new', 'page.tsx'), 'utf8')
const HANDOFF = readFileSync(join(HERE, '..', '..', 'lib', 'friends-broadcast-condition.ts'), 'utf8')

/*
 * R300: 低い帯が0人なのに引き継いだ友だち検索が5人になる。
 * スコア一覧の帯は「点数がついている人」だけを数えているのに、
 * 検索・配信へは点数範囲だけが渡り、未採点の0点まで拾っていた。
 * `scoredOnly` を帯の引き継ぎ全体に通し、一覧・検索・配信の対象をそろえる。
 */
describe('R300: 帯の引き継ぎは点数がついている人だけ', () => {
  it('スコア一覧の帯リンクに scoredOnly を付ける', () => {
    expect(SCORE_TAB).toContain("query.set('scoredOnly', '1')")
  })

  it('友だち一覧は scoredOnly を読み、検索口へ渡して帯に表示する', () => {
    expect(FRIENDS_PAGE).toContain("searchParams.get('scoredOnly')")
    expect(FRIENDS_PAGE).toContain('scoredOnly: scoredOnly || undefined')
    expect(FRIENDS_PAGE).toContain('点数がついている人のみ')
  })

  it('友だち一覧から配信への条件に scoredOnly を載せる', () => {
    expect(HANDOFF).toContain('scoredOnly')
    expect(FRIENDS_PAGE).toMatch(/buildBroadcastHandoff\(\{[\s\S]*scoredOnly/)
  })

  it('配信作成の帯リンク（scoreMin/scoreMax 直指定）も scoredOnly を読む', () => {
    expect(BROADCAST_NEW).toContain("params.get('scoredOnly')")
  })

  it('帯を選んだとき引き継ぐ対象を言葉で示す', () => {
    expect(SCORE_TAB).toContain('点数がついている人のみ')
  })
})
