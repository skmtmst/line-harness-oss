import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const editor = readFileSync(resolve(__dirname, './tag-editor-v4.tsx'), 'utf8')

/*
 * R137: 390pxで所属フォルダ・タグ名の欄の右端が表示領域の外へ出ていた。
 * happy-dom には配置計算が無いため、はみ出しの構図（グリッドの子の
 * 最小幅・長い印名の省略と全文確認）を源泉で固定する。実機の幅確認は
 * 撮影（司令塔）で行う。
 */
describe('R137 タグ編集のスマホはみ出し', () => {
  it('所属フォルダとタグ名の欄を縮められる（子の min-w-0）', () => {
    expect(editor).toContain('>所属フォルダ</span>')
    expect(editor).toContain('<label className="min-w-0"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">所属フォルダ</span>')
    expect(editor).toContain('<label className="min-w-0"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">タグ名')
  })

  it('できあがるタグの印は長い名前を省略し全文を確認できる', () => {
    expect(editor).toContain('できあがるタグ')
    expect(editor).toContain('truncate')
    expect(editor).toContain('title={name || undefined}')
  })

  it('右欄（できあがるタグ側）が中身で広がらない', () => {
    expect(editor).toContain('<aside className="min-w-0 space-y-4">')
  })
})
