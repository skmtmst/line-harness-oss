import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 「＋ シナリオを作る」で空の行を作らない（#949 N-055）。
 *
 * 以前は押した時点で POST /api/scenarios を打ち、配信方式や1通目の設定を
 * 放り出されると、名前も通も無い空の行が一覧に残った。一覧のボタンは
 * 方式選択画面へ送るだけで、行を作るのは方式を確定したとき。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('シナリオ作成ボタンは行を作らない（#949 N-055）', () => {
  it('作成ボタンは方式選択へ送るだけで、POSTを打たない', () => {
    const handleCreate = PAGE.slice(
      PAGE.indexOf('const handleCreate'),
      PAGE.indexOf('const handleReorder'),
    )
    expect(handleCreate).not.toContain('api.scenarios.create')
    expect(handleCreate).toContain("router.push('/scenarios/mode')")
    // id なしで送る。行が無いことを方式選択画面が区別できるように。
    expect(handleCreate).not.toContain('?id=')
  })

  it('ボタンを押したあとの作成中状態を持たない（作っていないので）', () => {
    expect(PAGE).not.toContain('setCreating')
    expect(PAGE).not.toContain("'作成中…'")
  })
})
