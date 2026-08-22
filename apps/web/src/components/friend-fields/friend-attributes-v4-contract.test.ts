import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('友だち属性 V4 contract', () => {
  it('タグ作成で本人・紹介者マイルと倍率を同時に設定できる', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/new-tag-page-v4.tsx')
    expect(editor).toContain('本人へのマイル付与')
    expect(editor).toContain('紹介者へのマイル付与')
    expect(editor).toContain('今後のマイル倍率')
    expect(editor).toContain('タグを外して付け直したときの扱い')
    expect(page).toContain('applyToExisting: false')
  })

  it('タグ編集の遡及付与は初期OFFで専用確認を通す', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/edit-tag-page-v4.tsx')
    expect(editor).toContain("useState(initialValues?.applyToExisting ?? initialApplyToExisting)")
    expect(editor).toContain('すでに付いている人への反映')
    expect(editor).toContain('さかのぼってマイルを積みますか？')
    expect(page).toContain('applyToExisting: applyRetroactive && values.applyToExisting')
  })

  it('一覧は20・30・40・50件で切り替え、ページを無限に横並びにしない', () => {
    const source = read('components/friend-attributes-v4/friend-attributes-view.tsx')
    for (const label of ['20件表示', '30件表示', '40件表示', '50件表示']) expect(source).toContain(label)
    expect(source).toContain('前へ')
    expect(source).toContain('次へ')
    expect(source).toContain('CSVで一括登録')
    expect(source).not.toContain('min-w-[1180px]')
  })

  it('情報欄と対応マークもPC画面で横スクロールを要求しない', () => {
    const sources = [
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).toContain('table-fixed')
      expect(source).not.toMatch(/min-w-\[/)
      expect(source).not.toContain('overflow-x-auto')
    }
  })

  it('友だち属性ではブラウザ標準confirmを使わない', () => {
    const sources = [
      read('components/friend-attributes-v4/friend-attributes-view.tsx'),
      read('components/friend-fields/tag-editor-v4.tsx'),
      read('components/friend-fields/edit-tag-page-v4.tsx'),
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
      read('components/friend-fields/saved-search-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\bconfirm\s*\(/)
    }
  })

  it('Pen.devで指定された8状態を検証用ルートから再現できる', () => {
    const source = read('app/visual-qa/friend-attributes/page.tsx')
    for (const state of ['list', 'create', 'linked', 'drawer', 'edit', 'retroactive', 'delete', 'folder']) {
      expect(source).toContain(`'${state}'`)
    }
    expect(source).toContain('LINKED_ACTIONS')
    expect(source).toContain('initialRetroactiveOpen')
    expect(source).toContain('<DeleteDialog')
    expect(source).toContain('<FolderEditor')
  })

  it('タグの作成・編集・一覧ルートはV4を既定表示にする', () => {
    expect(read('app/tags/page.tsx')).toContain('<FriendAttributesView')
    expect(read('app/tags/new/page.tsx')).toContain('<NewTagPageV4 />')
    expect(read('app/tags/edit/page.tsx')).toContain('<EditTagPageV4 />')
  })
})
