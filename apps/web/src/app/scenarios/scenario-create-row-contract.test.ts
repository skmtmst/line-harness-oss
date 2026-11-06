import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 「＋ シナリオを作る」で空の行を作らない（#949 N-055）。
 *
 * 押すと方式選びへ送るだけで作らない動きは v8/scenarios/list-counts-and-actions.test.tsx が
 * 描いて押して守る。ここは作成中の状態を持つ書き方へ戻さない禁止の見張りだけを残す。
 */
/* 完全切り替え：管理画面 の page.tsx は捨て、V8 の一覧（src/v8/scenarios/list.tsx・page.tsx が描く本体）を見る。 */
const PAGE = readFileSync(new URL('../../v8/scenarios/list.tsx', import.meta.url), 'utf8')

describe('シナリオ作成ボタンは行を作らない（#949 N-055）', () => {
  it('作成ボタンは方式選択へ送るだけで、POSTを打たない', () => {
    const handleCreate = PAGE.slice(
      PAGE.indexOf('const handleCreate'),
      PAGE.indexOf('const handleReorder'),
    )
    expect(handleCreate).not.toContain('api.scenarios.create')
    // id なしで送る。行が無いことを方式選択画面が区別できるように。
    expect(handleCreate).not.toContain('?id=')
  })

  it('ボタンを押したあとの作成中状態を持たない（作っていないので）', () => {
    expect(PAGE).not.toContain('setCreating')
    expect(PAGE).not.toContain("'作成中…'")
  })
})
