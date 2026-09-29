import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const source = readFileSync(resolve(root, 'components/friend-fields/tags-page-v4.tsx'), 'utf8')

describe('タグ一覧の操作失敗と再取得の契約', () => {
  it('一覧の行にフォルダの選び直し欄を置かない（列の幅に収まらず隣へ重なるため）', () => {
    expect(source).not.toContain('<FolderSelect')
    expect(source).not.toContain('api.tags.setGroup')
  })

  it('フォルダの列は文字だけ出し、長い名前は省略して全文は重ねて読める', () => {
    expect(source).toContain("title={group?.name ?? '未分類'}")
    expect(source).toContain('{group?.name ?? \'未分類\'}')
  })

  it('フォルダの変更は編集画面の「所属フォルダ」で行う', () => {
    const editor = readFileSync(resolve(root, 'components/friend-fields/tag-editor-v4.tsx'), 'utf8')
    expect(editor).toContain('所属フォルダ')
  })

  it('★切替の成功は手元だけ直して全件を取り直さない', () => {
    expect(source).toContain('setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: next } : item))')
  })

  it('★切替の失敗は元に戻して理由を出す', () => {
    expect(source).toContain('setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: tag.isStarred } : item))')
    expect(source).toContain("'表示の切り替えに失敗しました。通信を確かめて、もう一度お試しください。'")
  })
})
