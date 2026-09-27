import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * R37: メディア・共通情報のフォルダに名前変更・削除の操作が接続されていない。
 * 追加だけあって直し・消しが無いと、整理し直す手段が無い。
 * 両一覧とも共通の FolderPanel の「…」へ接続し、消す前に
 * 「中身は未分類に戻ります」と確認の窓（ConfirmDialog）を出す。
 */

const MEDIA = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const VARS = readFileSync(new URL('./vars/page.tsx', import.meta.url), 'utf8')

describe('R37 フォルダの名前変更・削除の接続', () => {
  it('メディア一覧は FolderPanel の行に名前変更・削除を渡す', () => {
    expect(MEDIA).toContain('onEdit: canManageMedia ? () => setEditingFolder(folder) : undefined')
    expect(MEDIA).toContain('onDelete: canManageMedia')
    expect(MEDIA).toContain("deleteNote: '削除しても、中のメディアは未分類に残ります。'")
  })

  it('メディア一覧は名前を直す窓と消す前の確認の窓を出す', () => {
    expect(MEDIA).toContain('<FolderAddDialog')
    expect(MEDIA).toContain('kind="media"')
    expect(MEDIA).toContain('folder={editingFolder}')
    expect(MEDIA).toContain('フォルダ「${deletingFolder?.name ??')
    expect(MEDIA).toContain('削除しても、中のメディアは未分類に残ります。')
    expect(MEDIA).toContain('api.folders.delete(deletingFolder.id')
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
    expect(VARS).toContain('フォルダを削除')
    expect(VARS).toContain('canManageFolders && selectedUserFolder')
  })

  it('権限の無い人には押して失敗する口を見せない', () => {
    expect(VARS).toContain('canManageFolders')
    expect(VARS).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
  })
})
