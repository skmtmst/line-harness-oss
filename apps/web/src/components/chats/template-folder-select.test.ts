import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const SELECT = readFileSync(join(HERE, 'template-folder-select.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('受信箱V6のテンプレートフォルダ', () => {
  it('標準selectではなく、開状態を確認できるリストを使う', () => {
    expect(PICKER).toContain('TemplateFolderSelect')
    expect(SELECT).toContain('aria-haspopup="listbox"')
    expect(SELECT).toContain('aria-expanded={open}')
    expect(SELECT).toContain('role="listbox"')
    expect(SELECT).not.toContain('<select')
  })

  it('既存APIのfolderIdを落とさず、親を選ぶと子のテンプレートも出す', () => {
    expect(API).toContain('folderId: string | null;')
    expect(PICKER).toContain('selectedFolderIds')
    expect(PICKER).toContain('folder.parentId === folderId')
  })

  it('未分類と0件を、未取得と混同せず選べる', () => {
    expect(PICKER).toContain("value: '__none__'")
    expect(PICKER).toContain("label: '未分類'")
    expect(PICKER).toContain("folderCounts.get('') ?? 0")
    expect(PICKER).toContain("folderId === '__none__' ? Boolean(t.folderId)")
    expect(PICKER).toContain("visibleTemplatesStatus === 'ready' ? `${shown.length}件` : '—'")
    expect(PICKER).toContain('テンプレートを読み込めませんでした。もう一度開き直してください。')
    expect(SELECT).toContain("disabled={status !== 'ready'}")
    expect(SELECT).toContain("option.count ?? '—'")
  })

  it('開くたびに前のLINEアカウントの内容を消してから読み直す', () => {
    expect(PICKER).toContain('const { selectedAccountId } = useAccount()')
    expect(PICKER).toContain('loadedAccountId === selectedAccountId')
    expect(PICKER).toContain('accountDataCurrent ? templates : []')
    expect(PICKER).toContain('setTemplates([])')
    expect(PICKER).toContain('setFolders([])')
    expect(PICKER).toContain("setTemplatesStatus('loading')")
    expect(PICKER).toContain("setFoldersStatus('loading')")
    expect(PICKER).toContain('}, [open, selectedAccountId])')
  })
})
