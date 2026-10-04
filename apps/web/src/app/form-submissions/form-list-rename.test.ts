import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')

/*
 * v7 の行の「…」にある「名前を変更」は V8 の行にも要る。
 * 保存は編集保存と同じ口（PUT /api/forms/:id）に版を添える。
 * ここでは結び付けだけを見る。
 */
describe('回答フォーム一覧の名前を変更', () => {
  it('行の「…」に名前を変更がある', () => {
    expect(LIST).toContain("id: 'rename'")
    expect(LIST).toContain("label: '名前を変更'")
    expect(LIST).toContain('openRename(form)')
  })

  it('版を読んでから保存する', () => {
    expect(LIST).toContain('contentRevision')
    expect(LIST).toContain('expectedContentRevision')
    expect(LIST).toContain('フォーム名を変更')
  })
})
