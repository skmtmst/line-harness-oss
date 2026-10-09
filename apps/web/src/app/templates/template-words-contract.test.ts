import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(new URL('../../v8/templates/list.tsx', import.meta.url), 'utf8')
/* 種類の呼び方は `./template-message-type` に一本化した（#497 軽2）。 */
const MESSAGE_TYPE = readFileSync(new URL('template-message-type.ts', import.meta.url), 'utf8')
const EDIT_PAGE = readFileSync(new URL('../../v8/template-edit/message.tsx', import.meta.url), 'utf8')
const MESSAGE_EDITOR = readFileSync(new URL('../../components/templates/message-template-editor.tsx', import.meta.url), 'utf8')
const CAROUSEL_PAGE = readFileSync(new URL('../../v8/templates/carousel.tsx', import.meta.url), 'utf8')
// 組み立て・保存の正本は core へ出した（page.tsx は自由な export を持てない）。
// 契約は「画面が使う全体」を見るため、ページ＋共有モジュールをつなげて読む。
const CAROUSEL_CORE = readFileSync(new URL('carousel/carousel-core.ts', import.meta.url), 'utf8')
const ASSET_EDITOR = readFileSync(new URL('template-asset-editor.tsx', import.meta.url), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）に、内部の値を出さない。
 *
 * #10 の撮影で、種類の欄に `text`、種類の札に `Flex` `Carousel` が出て
 * いた。**LINE の作りの名前は運用する人には通じない。**
 */
describe('種類の呼び方', () => {
  it('LINEの作りの名前をそのまま出さない', () => {
expect(PAGE).toContain("from './words'")
    expect(MESSAGE_TYPE).toContain("flex: 'カード型'")
    expect(MESSAGE_TYPE).toContain("carousel: 'カルーセル'")
  })

  it('絞り込みの札にも内部の名前を出さない', () => {
expect(PAGE).toContain('複数通')
    expect(PAGE).not.toContain("label: 'Flex'")
  })

  it('知らない種類でも内部の値を出さない', () => {
    /*
     * `?? t.messageType` だと、`sticker` や `video` のひな形が並んだとき
     * **画面に英語の値がそのまま出る**。
     */
    expect(MESSAGE_TYPE).toContain("return messageTypeLabels[type] ?? 'その他'")
    expect(PAGE).not.toContain('?? t.messageType}')
    expect(PAGE).not.toContain('?? drawerData.messageType}')
  })

  it('`category` を画面へ流さない', () => {
    /* `text` `general` は内部の値。分け方はフォルダが受け持つ。 */
    expect(PAGE, 'category を出している').not.toMatch(/\{t\.category \|\| '未分類'\}/)
  })
})

/**
 * 使用先の数（要件 §9「未取得は `—` とラベル」）。
 */
describe('使われている数', () => {
  it('数えられていないものを 0 と書かない', () => {
expect(PAGE).toContain("typeof t.usageCount !== 'number'")
    expect(PAGE).toContain('t.usageCount === 0')
    expect(PAGE).not.toContain('t.usageCount ?? 0')
  })
})

describe('V6の作成画面', () => {
  it('本文のURLと差し込み後のLINE表示を確認できる', () => {
expect(EDIT_PAGE).toContain('<LinePreview')
    expect(EDIT_PAGE).toContain('preview.unresolved')
    expect(EDIT_PAGE).not.toContain('内容 / JSON')
  })

  it('カルーセルをパネルとして最大10枚まで扱う', () => {
expect(CAROUSEL_CORE).toContain('const MAX_COLUMNS = 10')
    expect(CAROUSEL_PAGE).toContain('panels.length >= MAX_COLUMNS')
    expect(CAROUSEL_PAGE).toContain('panel.actions.length >= MAX_ACTIONS')
    expect(CAROUSEL_PAGE).toContain('<LinePreview')
  })

  it('リッチメッセージ・クーポン・リサーチを保存APIへ接続する', () => {
    expect(ASSET_EDITOR).toContain("'rich_message' | 'coupon' | 'research'")
    expect(ASSET_EDITOR).toContain('api.broadcastMessageAssets.create')
    expect(ASSET_EDITOR).toContain('面の分け方')
    expect(ASSET_EDITOR).toContain('クーポンが使われたときに実行すること')
    expect(ASSET_EDITOR).toContain('回答フォームとの使い分け')
  })
})
