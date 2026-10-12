import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8')
const editor = read('v8/tag-edit/edit-form.tsx')
const css = read('v8/tag-edit/edit.module.css')
describe('R137 タグ編集の狭幅表示', () => {
  it('所属フォルダとタグ名の欄は幅を縮められる', () => {
    expect(editor).toContain('aria-label="所属フォルダ"')
    expect(editor).toMatch(/<Field\b[^>]*label="タグ名"/)
    expect(css).toMatch(/\.field \{[^}]*min-width: 0/)
    expect(css).toContain('.selectBox { min-width: 0; }')
  })
  it('統括の完成見本は共通のタグ札で長い名前を省略し全文も読める', () => {
    const hq = read('v8/hq-templates/tag-editor.tsx')
    expect(hq).toContain('できあがるタグ')
    expect(hq).toContain('<TagPill name={values.name')
    expect(read('components/shared/tag-pill.tsx')).toContain('<TruncatedText className={styles.name} value={name} />')
  })
  it('右の使用先の列は板の幅に収まる', () => {
    expect(editor).toContain('className={styles.side}')
    expect(css).toMatch(/\.side \{[^}]*width: 100%/)
    expect(css).toMatch(/\.useRow > dd \{[^}]*min-width: 0/)
  })
})
