import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const EDIT = readFileSync(new URL('./edit/page.tsx', import.meta.url), 'utf8')
const CONNECTIONS = readFileSync(new URL('./connections/page.tsx', import.meta.url), 'utf8')
const CANVAS = readFileSync(
  new URL('../../components/rich-menus/canvas-editor.tsx', import.meta.url),
  'utf8',
)
const TAG_MODAL = readFileSync(
  new URL('../../components/rich-menus/apply-to-tag-modal.tsx', import.meta.url),
  'utf8',
)

/**
 * #578（点検 #502 の軽）。動作を変えない整理だけ。
 * rAF間引き・メモ化・寸法一本化・対応表一本化・事前拒否の是非は別途。
 */
describe('#578 リッチメニューの軽整理', () => {
  it('取得結果を as で断定せず、形を確かめる', () => {
    expect(EDIT).toContain('function isGroupResponse')
    expect(EDIT).not.toContain('res.data as Group')
    expect(CONNECTIONS).toContain('function isRichMenuGroupResponse')
    expect(CONNECTIONS).not.toContain('response.data as RichMenuGroup')
  })

  it('canvas の ref・event を非null断言と as で扱わない', () => {
    expect(CANVAS).not.toContain('canvasRef.current!')
    expect(CANVAS).not.toContain('e.target as HTMLElement')
    expect(CANVAS).toContain('instanceof HTMLElement')
  })

  it('画像エラーの英語原文をそのまま出さない', () => {
    expect(EDIT).toContain('imageUploadErrorText(e)')
    expect(EDIT).toContain('1MB以下の画像を選んでください')
    expect(EDIT).toContain('2500×1686')
  })

  it('取り下げの部分的失敗を日本語の定型文に写す', () => {
    expect(EDIT).toContain('unpublishWarningText')
    expect(EDIT).not.toContain('warnings.join(')
    expect(EDIT).toContain('切り替え設定の一部を取り下げきれていません')
  })

  it('タグ取得の失敗を黙らせず、注記と再試しを出す', () => {
    expect(TAG_MODAL).toContain('tagsLoadError')
    expect(TAG_MODAL).toContain('タグを読み込めませんでした')
    expect(TAG_MODAL).toContain('もう一度読み込む')
    expect(TAG_MODAL).not.toContain('タグ取得失敗 = 一覧空のまま')
  })
})
