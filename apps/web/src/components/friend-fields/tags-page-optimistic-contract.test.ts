import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const source = readFileSync(resolve(root, 'v8/tags/tags-tab.tsx'), 'utf8')
const editor = readFileSync(resolve(root, 'v8/tag-edit/edit.tsx'), 'utf8')
const form = readFileSync(resolve(root, 'v8/tag-edit/edit-form.tsx'), 'utf8')

describe('タグ一覧・編集の操作失敗と再取得の契約', () => {
  it('一覧に行ごとのフォルダ選び直し欄を置かず、移動は行メニューから行う', () => {
    expect(source).not.toContain('<FolderSelect')
    expect(source).toContain('moveTagToGroup(tag,')
  })
  it('フォルダは省略できる文字と色の印で出し、全文も読める', () => {
    const dot = readFileSync(resolve(root, 'components/shared/folder-dot.tsx'), 'utf8')
    expect(dot).toContain('title={label}')
    expect(dot).toContain("const label = `フォルダ：${folder?.name ?? '未分類'}`")
    expect(source).toContain('<FolderDotName folder={group}>')
  })
  it('所属フォルダは編集フォームでも変更できる', () => {
    expect(form).toContain('所属フォルダ')
  })
  it('友だち一覧への表示設定は版付きの保存で更新し、成功後に最新を読む', () => {
    expect(editor).toContain('isStarred: values.isStarred')
    expect(editor).toContain('api.tags.updateDefinition(tag.id, selectedAccountId, tag.version ?? 1, payload,')
    expect(editor).toContain('await load(true)')
  })
  it('表示設定の保存競合は下書きを保ち、比較か読み直しへ進める', () => {
    expect(editor).toContain('reason instanceof ApiError && reason.status === 409')
    expect(editor).toContain('setConflictValues(values)')
    expect(form).toContain('<SaveConflictBand')
    expect(form).toContain('onReload={onReloadLatest}')
  })
})
