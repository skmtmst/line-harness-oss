import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'src/v8/tags/tags-tab.tsx'), 'utf8')
const panel = readFileSync(resolve(process.cwd(), 'src/components/shared/folder-panel.tsx'), 'utf8')

describe('R165 狭い画面のフォルダ管理導線', () => {
  it('畳まれたフォルダ選択から同じ管理操作を開ける', () => {
    expect(page).toContain("value: '__manage_folders__', label: 'フォルダを管理'")
    expect(page).toContain("next === '__manage_folders__' ? setManageFoldersOpen(true) : setFolder(next)")
    expect(page).toContain('<FolderManagementDialog open={manageFoldersOpen} rows={folderRows}')
    const dialog = readFileSync(resolve(process.cwd(), 'src/components/shared/managed-folder-panel.tsx'), 'utf8')
    expect(dialog).toContain('title="フォルダを管理"')
    expect(dialog).toContain('<FolderPanel')
    expect(page.match(/rows=\{folderRows\}/g)).toHaveLength(2)
    for (const action of ['onEdit:', 'onMoveUp:', 'onMoveDown:', 'onDelete:']) expect(page).toContain(action)
  })

  it('フォルダの操作ボタンはホバーがない画面でも使える', () => {
    expect(panel).toContain('aria-label={`フォルダ「${row.label}」の操作`}')
    expect(panel).not.toContain('invisible group-hover:visible')
    expect(panel).toContain('onClick={() => setOpenMenuId((current) => (current === row.id ? null : row.id))}')
  })
})
