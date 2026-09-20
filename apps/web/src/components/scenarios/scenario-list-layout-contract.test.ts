import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(path.join(__dirname, 'scenario-list.tsx'), 'utf8')

describe('シナリオ一覧の列幅と並び替え案内', () => {
  it('名前列だけが残り幅を受け取り、ほかの列は固定幅にする（NEXT-25）', () => {
    /*
      ウインドウ幅ではなく列の合計で決める。以前は 1536px の
      メディアクエリで3列を増やしていたが、フォルダの帯を引いた
      表の実幅では名前列が潰れて見出しが重なり、右端の操作が切れていた。
      いまは補足列を名前の下へ畳んだ固定6列だけなので、幅で列を
      出し分ける仕組み自体を持たない。
    */
    expect(LIST).toContain('min-w-[640px] table-fixed')
    expect(LIST).not.toContain('matchMedia')
    expect(LIST).not.toContain('showSecondaryColumns')
    expect(LIST).not.toContain('hidden={!showSecondaryColumns}')
    expect(LIST).not.toContain('<Th className="w-full max-w-0">')
  })

  it('行のフォルダ選択を持たず、移動は「その他→フォルダを移動」へ集約する（NEXT-25）', () => {
    // 各行の幅176pxの select が名前列を潰していた。フォルダの所在は
    // 名前の下の短い札だけにし、変える操作はメニューと一括選択へ。
    expect(LIST).not.toContain('v6-select h-9 w-36')
    expect(LIST).toContain("id: 'move'")
    expect(LIST).toContain("label: 'フォルダを移動'")
    expect(LIST).toContain('ActionMenu')
    expect(LIST).toContain('MoreAction')
  })

  it('複数選択でフォルダを一括移動できる（NEXT-25）', () => {
    expect(LIST).toContain('aria-label="このページのシナリオをすべて選択"')
    expect(LIST).toContain('件を選択中')
    expect(LIST).toContain('onMoveFolders')
    expect(LIST).toContain('移動先のフォルダ')
  })

  it('表の外に並び替え案内の押し口を置かず、行の取っ手で説明する', () => {
    expect(LIST).not.toContain('並び替えは ⠿ を掴む')
    expect(LIST).not.toContain('並び替えは⠿を掴む')
    expect(LIST).toContain('title="上下に動かして並び替え"')
  })

  it('長い名前は1行省略で、全文は title で読める（NEXT-25）', () => {
    expect(LIST).toContain('min-w-0 truncate text-sm font-medium')
    expect(LIST).toContain('title={s.name}')
  })
})
