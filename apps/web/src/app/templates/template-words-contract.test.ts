import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')
/* 種類の呼び方は `./template-message-type` に一本化した（#497 軽2）。 */
const MESSAGE_TYPE = readFileSync(join(HERE, '../../v8/templates/words.ts'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, '../../v8/template-edit/message.tsx'), 'utf8')
const MESSAGE_EDITOR = readFileSync(join(HERE, '../../components/templates/message-template-editor.tsx'), 'utf8')
  + readFileSync(join(HERE, '../../components/templates/template-preview-model.ts'), 'utf8')
const CAROUSEL_PAGE = readFileSync(join(HERE, '../../v8/templates/carousel.tsx'), 'utf8')
// 組み立て・保存の正本は core へ出した（page.tsx は自由な export を持てない）。
// 契約は「画面が使う全体」を見るため、ページ＋共有モジュールをつなげて読む。
const CAROUSEL_CORE = readFileSync(join(HERE, '../../v8/templates/carousel-core.ts'), 'utf8')
const ASSET_EDITOR = readFileSync(join(HERE, '../../v8/template-edit/asset.tsx'), 'utf8')
  + readFileSync(join(HERE, '../../v8/template-edit/rich.tsx'), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）に、内部の値を出さない。
 *
 * #10 の撮影で、種類の欄に `text`、種類の札に `Flex` `Carousel` が出て
 * いた。**LINE の作りの名前は運用する人には通じない。**
 */
describe('種類の呼び方', () => {
  it('LINEの作りの名前をそのまま出さない', () => {
    expect(MESSAGE_TYPE).toContain("flex: 'カード型'")
    expect(MESSAGE_TYPE).toContain("carousel: 'カルーセル'")
    expect(MESSAGE_TYPE, '内部の名前が残っている').not.toMatch(/flex: 'Flex'|carousel: 'Carousel'/)
    /* 一覧は共通化先を使い、独自の呼び方を持たない。 */
    expect(PAGE).toContain("from './words'")
  })

  it('絞り込みの札にも内部の名前を出さない', () => {
    /* 一覧の上の札と、作る画面の選び口。どちらも運用の言葉にする。 */
    expect(PAGE).toContain("複数通")
    expect(PAGE).toContain("差し込みあり")
    /* 選び口は共通の `Select` へ寄せたので、options で並ぶ。 */
    expect(PAGE).toContain("messageTypeText(kindLabel)")
    expect(PAGE, '失敗の文に内部の語が出ている').not.toContain('Flex JSON parse 失敗')
  })

  it('知らない種類でも内部の値を出さない', () => {
    /*
     * `?? t.messageType` だと、`sticker` や `video` のひな形が並んだとき
     * **画面に英語の値がそのまま出る**。
     */
    expect(MESSAGE_TYPE).toContain("return MESSAGE_TYPE_LABELS[type] ?? 'その他'")
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
    /*
     * `usageCount` を持たないひな形で「undefined件で使用」と出ていた。
     * **0 は「どこでも使われていない」という別の意味。**
     */
    expect(PAGE).toContain("typeof t.usageCount !== 'number'")
    /* 数があるときだけ「N件で使用」。0 は「なし」と書き分ける。 */
    expect(PAGE).toContain("t.usageCount === 0 ?")
  })
})

describe('V8の作成画面', () => {
  it('本文のURLと差し込み後のLINE表示を確認できる', () => {
    expect(EDIT_PAGE).toContain('extractMessageUrls(messageContent)')
    expect(EDIT_PAGE).toContain('buildTemplatePreview(messageContent, references)')
    expect(MESSAGE_EDITOR).toContain('本文に入れたURLの扱い')
    // : 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(MESSAGE_EDITOR).toContain('<LinePreview')
    expect(MESSAGE_EDITOR).toContain("if (name === 'name') return '山田 太郎'")
    expect(MESSAGE_EDITOR).toContain('preview.unresolved.length > 0')
    expect(EDIT_PAGE).not.toContain('内容 / JSON')
  })

  it('カルーセルをパネルとして最大10枚まで扱う', () => {
    expect(CAROUSEL_PAGE + CAROUSEL_CORE).toContain('const MAX_COLUMNS = 10')
    // 選択肢の上限は直書きせず MAX_ACTIONS。数は全部のパネルでそろえる決まりも添える。
    expect(CAROUSEL_PAGE).toContain('ボタン（最大 ${MAX_ACTIONS} つ）')
    expect(CAROUSEL_PAGE).toContain('disabled={panel.actions.length >= MAX_ACTIONS}')
    expect(CAROUSEL_PAGE).toContain('画像は横1024 × 縦678pxを推奨')
    // : 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(CAROUSEL_PAGE).toContain('<LinePreview')
  })

  it('リッチメッセージ・クーポン・リサーチを保存APIへ接続する', () => {
    expect(ASSET_EDITOR).toContain("kind: 'rich_message'")
    expect(ASSET_EDITOR).toContain("kind === 'coupon'")
    expect(ASSET_EDITOR).toContain('api.broadcastMessageAssets.create')
    expect(ASSET_EDITOR).toContain('<LayoutPicker')
    expect(ASSET_EDITOR).toContain('<TapAreaEditor')
    expect(ASSET_EDITOR).toContain('使われたときに行うこと')
    expect(ASSET_EDITOR).toContain('回答フォームとの使い分け')
  })
})
