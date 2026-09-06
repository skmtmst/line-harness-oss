import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROW = fs.readFileSync(path.join(__dirname, 'friend-list-row.tsx'), 'utf8')
const TABLE = fs.readFileSync(path.join(__dirname, 'friend-list-table.tsx'), 'utf8')

describe('友だち一覧のV6表示契約', () => {
  it('日時を日付欄と同じスラッシュ区切りにする', () => {
    expect(ROW).toContain("slice(0, 16).replace(/-/g, '/')")
  })

  it('内部のメッセージ種別を運用者向けの名前にする', () => {
    expect(ROW).toContain("sticker: 'スタンプ'")
    expect(ROW).not.toContain('`[${latest.messageType}]`')
  })

  it('表示件数メニューに安定した撮影の押し口がある', () => {
    expect(TABLE).toContain('data-qa-open="LT8RS"')
    for (const size of ['10', '20', '30', '40', '50']) {
      expect(TABLE).toContain('pageSizeOptions.map')
      expect(size).toMatch(/\d+/)
    }
  })
})
