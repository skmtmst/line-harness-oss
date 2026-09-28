import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * 下書き・予約の「編集を続ける」導線（監査 R207）。
 *
 * 一覧の操作列は固定幅（詳細＋…）なので、枠ボタンは増やさず
 * 「…」の中へ入れる。幅契約（broadcasts-list-fit-contract）は変えない。
 * 同じIDで開き直す（別名の複製ではない）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('一斉配信の一覧の下書き再開（R207）', () => {
  it('下書き・予約に「編集を続ける」がある', () => {
    expect(PAGE).toContain('編集を続ける')
  })

  it('同じIDで作成画面を開き直す（複製ではない）', () => {
    expect(PAGE).toContain('/broadcasts/new?draft=')
    expect(PAGE).not.toMatch(/編集を続ける[\s\S]{0,200}duplicateFrom/)
  })

  it('送信済みには出さない（下書き・予約だけ）', () => {
    const resumeBlock = PAGE.slice(
      PAGE.indexOf('監査 R207'),
      PAGE.indexOf('監査 R207') + 1200,
    )
    expect(resumeBlock).toContain("broadcast.status === 'draft'")
    expect(resumeBlock).toContain("broadcast.status === 'scheduled'")
  })

  it('操作列の幅契約を変えていない（枠ボタンは増やさない）', () => {
    // 「…」の中なので、RowActions に edit 枠は足さない。
    const rowActionsBlock = PAGE.slice(PAGE.indexOf('<RowActions'), PAGE.indexOf('<RowActions') + 1500)
    expect(rowActionsBlock).not.toContain('edit={{')
  })
})
