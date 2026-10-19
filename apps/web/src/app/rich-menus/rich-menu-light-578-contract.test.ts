import { isGroupResponse } from '../../v8/rich-menus/new/create-draft'
import { ApiError } from '@/lib/api'
import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
import { SIZE_LABEL } from '../../v8/rich-menus/new/create-options'
import { imageUploadErrorText } from '../../v8/rich-menus/new/image-upload-error'

const EDIT = readFileSync(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const UNPUBLISH = readFileSync(new URL('../../v8/rich-menu-edit/detail.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('../../v8/rich-menus/errors.ts', import.meta.url), 'utf8')
const CONNECTIONS = readFileSync(new URL('../../v8/rich-menus/connections.tsx', import.meta.url), 'utf8')
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
    expect(isGroupResponse({ id: 'menu', name: '案内', pages: [] })).toBe(true)
    for (const value of [null, {}, { id: 1, name: '案内', pages: [] }, { id: 'menu', name: '案内', pages: null }]) expect(isGroupResponse(value)).toBe(false)
    const loadEdit = EDIT.slice(EDIT.indexOf('const loadEditGroup'), EDIT.indexOf('/* ---------- 下書きの作成・保存'))
    expect(loadEdit).toContain('isGroupResponse(res.data)')
    expect(loadEdit).not.toContain('res.data as Group')
    expect(CONNECTIONS).toContain('function isRichMenuGroupResponse')
    expect(CONNECTIONS).not.toContain('response.data as RichMenuGroup')
  })

  it('canvas の ref・event を非null断言と as で扱わない', () => {
    expect(CANVAS).not.toContain('canvasRef.current!')
    expect(CANVAS).not.toContain('e.target as HTMLElement')
    expect(CANVAS).toContain('instanceof HTMLElement')
  })

  it('画像エラーの英語原文をそのまま出さない', () => {
    expect(imageUploadErrorText(new ApiError(400, 'exceeds 1MB limit'))).toContain('1MB以下の画像を選んでください')
    expect(imageUploadErrorText(new ApiError(400, 'dimensions mismatch'))).toBe(`画像の大きさが合いません。${SIZE_LABEL.large}（大）か${SIZE_LABEL.compact}（小）の画像を選んでください。`)
    expect(imageUploadErrorText(new ApiError(400, 'unrecognized image format'))).toBe('画像の形式はPNGかJPEGにしてください。')
    expect(imageUploadErrorText(new Error('internal server detail'))).toBe('画像を読み込めませんでした。もう一度お試しください。')
  })

  it('取り下げの部分的失敗を日本語の定型文に写す', () => {
    expect(UNPUBLISH).toContain('unpublishWarningText')
    expect(UNPUBLISH).not.toContain('warnings.join(')
    expect(UNPUBLISH).toContain('切り替え設定の一部を取り下げきれていません')
  })

  it('タグ取得の失敗を黙らせず、注記と再試しを出す', () => {
    expect(TAG_MODAL).toContain('tagsLoadError')
    expect(TAG_MODAL).toContain('タグを読み込めませんでした')
    expect(TAG_MODAL).toContain('もう一度読み込む')
    expect(TAG_MODAL).not.toContain('タグ取得失敗 = 一覧空のまま')
  })
})
