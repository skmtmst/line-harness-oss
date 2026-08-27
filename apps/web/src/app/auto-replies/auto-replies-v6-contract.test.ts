import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const EDITOR = fs.readFileSync(
  path.join(__dirname, '../../components/auto-replies/edit-dialog.tsx'),
  'utf8',
)

describe('V6 自動応答一覧の契約', () => {
  it('既存ルールを編集するときに所属フォルダを引き継ぐ', () => {
    expect(PAGE).toContain('folderId: r.folderId')
    expect(EDITOR).toContain("useState(draft.folderId ?? '')")
    expect(EDITOR).toContain('folderId: folderId || null')
  })
})
