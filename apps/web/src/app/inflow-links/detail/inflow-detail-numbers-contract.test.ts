import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * V6 流入リンク詳細の数字の契約（#514 重大3）。
 *
 * 口から取れない数を定数で書いていた（残り78人・ブロック8人・今月240回・
 * 1人あたり¥1,493・既定名・18人）。取れない数は出さない。未取得は「—」。
 */
describe('V6 流入リンク詳細の数字の契約', () => {
  it('口から取れない定数を書かない', () => {
    expect(PAGE).not.toContain('value={78}')
    expect(PAGE).not.toContain('今月 240回')
    expect(PAGE).not.toContain('1人あたり ¥1,493')
    expect(PAGE).not.toContain('体験前フォロー')
    expect(PAGE).not.toContain("'Instagram'")
    // 「マイルを 100 付ける」は設計正本にある文言のため残す。
    // 消すなら Pencil を先に直す（司令塔へ判断依頼 #531）。
    expect(PAGE).toContain('マイルを 100 付ける')
    expect(PAGE).not.toContain('18人います')
    expect(PAGE).not.toContain('ブロック率 9.3%')
  })

  it('取れない段は「—」+理由か、設定の有無で言い分ける', () => {
    expect(PAGE).toContain('残数とブロック数の集計は未接続です')
    expect(PAGE).toContain('反応・ブロックの集計は未接続のため表示できません')
    expect(PAGE).toContain('シナリオは始めない')
    expect(PAGE).toContain('タグは付けない')
  })
})
