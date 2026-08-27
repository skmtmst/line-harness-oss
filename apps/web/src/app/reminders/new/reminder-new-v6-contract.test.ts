import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 リマインダ作成の契約', () => {
  it('既存のリマインダ用フォルダを読み、作成時に選択を保存する', () => {
    expect(PAGE).toContain("api.folders.list('reminder')")
    expect(PAGE).toContain('folderId: folderId || null')
    expect(PAGE).toContain('setFolderId(event.target.value)')
  })

  it('フォルダ選択を準備中に戻さない', () => {
    expect(PAGE).not.toContain('フォルダ分けは準備中です')
    expect(PAGE).not.toMatch(/<select disabled[^>]*>[\s\S]*?<option>未分類<\/option>/)
  })
})
