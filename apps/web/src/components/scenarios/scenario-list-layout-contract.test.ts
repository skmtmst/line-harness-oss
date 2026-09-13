import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(path.join(__dirname, 'scenario-list.tsx'), 'utf8')

describe('シナリオ一覧の列幅と並び替え案内', () => {
  it('名前列と配信方式列を重ねず、名前列だけが残り幅を受け取る', () => {
    expect(LIST).toContain('min-w-[720px] table-fixed')
    expect(LIST).toContain('<col className="w-28" />')
    expect(LIST).toContain('<col className="w-44" />')
    expect(LIST).not.toContain('<Th className="w-full max-w-0">')
    expect(LIST).toContain('hidden={!showSecondaryColumns}')
  })

  it('表の外に並び替え案内の押し口を置かず、行の取っ手で説明する', () => {
    expect(LIST).not.toContain('並び替えは ⠿ を掴む')
    expect(LIST).not.toContain('並び替えは⠿を掴む')
    expect(LIST).toContain('title="上下に動かして並び替え"')
  })

  it('行のフォルダ選択は文字の左に12pxの内側余白を持つ', () => {
    expect(LIST).toContain('v6-select h-9 w-36 rounded-control border border-hairline bg-canvas pl-3')
  })
})
