import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const source = readFileSync(resolve(root, 'components/friend-fields/tags-page-v4.tsx'), 'utf8')

describe('タグ一覧の操作失敗と再取得の契約', () => {
  it('フォルダ付け替えの失敗は理由を出して再読込で隠さない', () => {
    expect(source).toContain('const result = await api.tags.setGroup(tag.id, groupId)')
    expect(source).toContain('if (!result.success) throw new Error(result.error)')
    expect(source).toContain("onError(reason instanceof ApiError ? reason.message : 'フォルダを変更できませんでした')")
  })

  it('フォルダ付け替えと★切替の成功は手元だけ直して全件を取り直さない', () => {
    expect(source).toContain('<FolderSelect tag={tag} groups={groups} onItemsChange={setItems} onError={setError} />')
    expect(source).toContain('onItemsChange((current) => current.map((item) => item.id === tag.id ? { ...item, groupId } : item))')
    expect(source).toContain('setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: next } : item))')
  })

  it('★切替の失敗は元に戻して理由を出す', () => {
    expect(source).toContain('setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: tag.isStarred } : item))')
    expect(source).toContain("'表示の切り替えに失敗しました'")
  })
})
