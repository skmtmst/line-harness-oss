import { describe, expect, it } from 'vitest'
import { folderSaveErrorMessage, isCurrentFolderRequest } from './folder-editor-state'

describe('フォルダ編集の非同期結果', () => {
  it('同じ対象・同じ世代の返事だけを採用する', () => {
    const current = { editId: 'folder-b', generation: 4 }

    expect(isCurrentFolderRequest(current, { editId: 'folder-b', generation: 4 })).toBe(true)
    expect(isCurrentFolderRequest(current, { editId: 'folder-a', generation: 4 })).toBe(false)
    expect(isCurrentFolderRequest(current, { editId: 'folder-b', generation: 3 })).toBe(false)
  })

  it('APIの生文を使わず、状態ごとの次の行動を返す', () => {
    expect(folderSaveErrorMessage(400)).toContain('60文字以内')
    expect(folderSaveErrorMessage(403)).toContain('管理者に確認')
    expect(folderSaveErrorMessage(404)).toContain('一覧へ戻って')
    expect(folderSaveErrorMessage(409)).toContain('最新の内容を読み直して')
    expect(folderSaveErrorMessage(500)).toContain('もう一度お試し')

    for (const status of [400, 403, 404, 409, 500]) {
      expect(folderSaveErrorMessage(status)).not.toMatch(/API|name|Internal|SQL/u)
    }
  })
})
