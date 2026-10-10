import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * R37: メディア・共通情報のフォルダに名前変更・削除の操作が接続されていない。
 * 追加だけあって直し・消しが無いと、整理し直す手段が無い。
 * 両一覧とも共通の FolderPanel の「…」へ接続し、消す前に
 * 「中身は未分類に戻ります」と確認の窓（ConfirmDialog）を出す。
 */

const MEDIA = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const VARS = readFileSync(new URL('./vars/page.tsx', import.meta.url), 'utf8')
const FOLDERS = readFileSync(new URL('../../components/shared/managed-folder-panel.tsx', import.meta.url), 'utf8') + readFileSync(new URL('../../components/shared/folder-row-actions.tsx', import.meta.url), 'utf8')

describe('R37 フォルダの名前変更・削除の接続', () => {
  it('メディア一覧は FolderPanel の行に名前変更・削除を渡す', () => {
    expect(MEDIA).toContain('<ManagedFolderPanel')
    expect(MEDIA).toContain('canManage={canManageMedia && Boolean(selectedAccountId)}')
    expect(FOLDERS).toContain('enabled: editable')
    expect(FOLDERS).toContain('actions.rowActions(folder, index).onEdit?.()')
    expect(FOLDERS).toContain('actions.rowActions(folder, index).onDelete?.()')
  })

  it('メディア一覧は名前を直す窓と消す前の確認の窓を出す', () => {
    expect(FOLDERS).toContain('<FolderAddDialog')
    expect(MEDIA).toContain('kind="media"')
    expect(FOLDERS).toContain('folder={editing}')
    expect(FOLDERS).toContain('中の${itemLabel}は未分類に残ります。')
    expect(FOLDERS).toContain('api.folders.delete(')
    expect(FOLDERS).toContain('<ConfirmDialog')
  })

  it('共通情報一覧は FolderPanel の行に名前変更・削除を渡す', () => {
    expect(VARS).toContain('onEdit: canManageFolders ? () => setEditingFolder(folder) : undefined')
    expect(VARS).toContain('onDelete: canManageFolders')
    expect(VARS).toContain("deleteNote: '削除しても、入っていた共通情報は未分類として残ります。'")
  })

  it('共通情報一覧は名前を直す窓と消す前の確認の窓を出す', () => {
    expect(VARS).toContain('<FolderAddDialog')
    expect(VARS).toContain('kind="common_var"')
    expect(VARS).toContain('folder={editingFolder}')
    expect(VARS).toContain('フォルダ「${deletingFolder?.name ??')
    expect(VARS).toContain('削除しても、入っていた共通情報は未分類として残ります。')
    expect(VARS).toContain('api.folders.delete(deletingFolder.id')
  })

  it('共通情報一覧はスマホの選択欄からも名前変更・削除に届く', () => {
    // 狭い幅では縦パネルが出ないため、選んでいるフォルダの操作口を置く。
    expect(VARS).toContain('フォルダ名を変える')
    expect(VARS).toContain('フォルダを削除する')
    expect(VARS).toContain('canManageFolders && selectedUserFolder')
  })

  it('権限の無い人には押して失敗する口を見せない', () => {
    expect(VARS).toContain('canManageFolders')
    expect(VARS).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
  })
})
