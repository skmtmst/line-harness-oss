import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const NEW = fs.readFileSync(path.join(__dirname, 'new-v8.tsx'), 'utf8')
const BASICS = fs.readFileSync(path.join(__dirname, '..', 'basics-form-v8.tsx'), 'utf8')

describe('V8 リマインダ作成の契約', () => {
  it('既存のリマインダ用フォルダを読み、作成時に選択を保存する', () => {
    expect(BASICS).toContain("api.folders.list('reminder')")
    expect(NEW).toContain('folderId: value.folderId || null')
  })

  it('選択中のLINEアカウントへ作る', () => {
    expect(NEW).toContain('lineAccountId: selectedAccountId!')
  })

  it('フォルダの読み込み失敗は選び直せる表示にし、準備中に戻さない', () => {
    expect(BASICS).toContain('フォルダを読み込めませんでした')
    expect(BASICS).toContain('再読み込み')
    expect(BASICS).not.toContain('フォルダ分けは準備中です')
    expect(BASICS).not.toMatch(/<select disabled[^>]*>[\s\S]*?<option>未分類<\/option>/)
  })
})
