import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COMPONENT = readFileSync(resolve(__dirname, 'tag-folder-dialog.tsx'), 'utf8')
const PAGE = readFileSync(resolve(__dirname, '../../app/tags/folders/new/page.tsx'), 'utf8')

describe('V6 タグフォルダ追加・編集', () => {
  it('設計 byqIW と同じダイアログを追加・編集で共用する', () => {
    expect(COMPONENT).toContain('data-design-node="byqIW"')
    expect(COMPONENT).toContain("editing ? 'フォルダを編集' : 'フォルダを追加'")
    expect(COMPONENT).toContain('size="compact"')
    expect(COMPONENT).toContain('showCloseButton')
  })

  it('既存のタグフォルダAPIを作成・更新・削除に使う', () => {
    expect(COMPONENT).toContain('api.tagGroups.create')
    expect(COMPONENT).toContain('api.tagGroups.update')
    expect(COMPONENT).toContain('api.tagGroups.delete')
  })

  it('未取得の件数を固定値で作らず、名前と色だけをプレビューする', () => {
    expect(COMPONENT).toContain('一覧での表示')
    expect(COMPONENT).not.toMatch(/\b101件\b|\b8件\b/)
  })

  it('本文タイトルを置かず、画面名を共通トップバーへ渡す', () => {
    expect(PAGE).toContain("usePageTitle('友だち属性')")
    expect(PAGE).not.toContain('<h1')
    expect(PAGE).not.toContain('text-[32px]')
  })

  it('一覧の上にダイアログを重ねる', () => {
    expect(PAGE).toContain('<TagsPageV4 />')
    expect(PAGE).toContain('<TagFolderDialog open')
  })

  it('タグと友だち情報欄の保存先を1画面で選ばせない', () => {
    expect(COMPONENT).not.toContain('friend_field')
    expect(COMPONENT).not.toContain('作成する場所')
  })
})
