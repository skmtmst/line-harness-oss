import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIALOG = readFileSync(new URL('./edit-dialog.tsx', import.meta.url), 'utf8')

/**
 * #975 U059: 390pxで長いプレビューの先に保存があるように見えないよう、
 * 設定確認・プレビューはワンタップで開く折り畳みにする。
 * 保存は下部追従バーにあり、スクロールなしで届く。
 */
describe('自動応答編集のプレビュー折り畳み（#975 U059）', () => {
  it('狭い幅ではプレビュー帯をワンタップで開く', () => {
    expect(DIALOG).toContain('mobilePreviewOpen')
    expect(DIALOG).toContain('届く形と設定の確認を見る')
    expect(DIALOG).toContain('xl:hidden')
    expect(DIALOG).toContain('max-xl:hidden')
  })

  it('保存は下部追従バー（sticky bottom-0）に置いたまま', () => {
    expect(DIALOG).toContain('sticky bottom-0')
    expect(DIALOG).toContain('actions={stickyActions}')
  })
})
