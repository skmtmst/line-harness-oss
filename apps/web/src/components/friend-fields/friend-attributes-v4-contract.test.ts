import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('友だち属性 V4 contract', () => {
  it('タグ作成で本人・紹介者マイルと倍率を同時に設定できる', () => {
    const source = read('app/tags/new/page.tsx')
    expect(source).toContain('本人へ付与するマイル')
    expect(source).toContain('紹介者へ付与するマイル')
    expect(source).toContain('タグを持っている間の倍率')
    expect(source).toContain('applyToExisting: false')
  })

  it('タグ編集の遡及付与は初期OFFで専用確認を通す', () => {
    const source = read('app/tags/edit/page.tsx')
    expect(source).toContain('useState(false)')
    expect(source).toContain('すでにこのタグが付いている人にも遡って付与する')
    expect(source).toContain('既存の友だちへマイルを遡及しますか？')
    expect(source).toContain('applyToExisting: confirmedRetroactive && applyToExisting')
  })

  it('一覧は20・30・40・50件で切り替え、ページを無限に横並びにしない', () => {
    const source = read('app/tags/page.tsx')
    expect(source).toContain('[20, 30, 40, 50]')
    expect(source).toContain('前へ')
    expect(source).toContain('次へ')
    expect(source).toContain('CSV出力')
    expect(source).toContain('並び替えを終了')
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
      read('app/tags/page.tsx'),
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
      read('components/friend-fields/saved-search-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\bconfirm\s*\(/)
      expect(source).toContain('ConfirmDialog')
    }
  })
})
