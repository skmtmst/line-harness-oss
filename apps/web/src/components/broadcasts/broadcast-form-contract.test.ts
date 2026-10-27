import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FORM = readUiSource(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

/**
 * 一斉配信の作成（設計 `zZ9fA` 6-1-A ／ `XQfMD` 6-1-C ／ `p97Tf` 6-1-D）の禁止の見張り。
 *
 * LINEプレビューの確認の記録・本文の上限（欄で止める・保存とテスト送信を止める・理由を出す）は
 * broadcast-form-preview-length-react.test.tsx が、知らない種類の呼び名は broadcast-form-model.test.ts が、
 * 未取得の人数を「—」で出すことは broadcast-form-final-confirm-react.test.tsx が見る。
 * **節の番号は `broadcast-section-numbers` の試験が見ている**ので、ここでは見ない。
 */
describe('一斉配信の作成', () => {
  it('本文の上限を直書きしない', () => {
    expect(FORM).not.toMatch(/maxLength=\{500\}/)
    expect(FORM).not.toMatch(/\/ 500/)
  })

  it('送信対象の未取得を半角ハイフンで書かない', () => {
    expect(FORM).not.toMatch(/formatNumber\([^)]+\) \?\? '-'/)
  })

  it('知らない種類でも内部の語を出さない', () => {
    // `?? template.messageType` だと札に `text` や `carousel` が出る。
    expect(FORM).not.toContain('?? template.messageType')
  })
})

/*
 * 狭い幅での横はみ出し。
 *
 * 素材を引用した吹き出しの見出し行（種類の選択肢＋移動・削除）が折れないと、
 * 390px で解除や並べ替えが右側へ隠れる。段の列自体も縮める。
 * 見た目の値なので画面を動かす試験では赤くできない。実ブラウザの崩れの見張りに移すまで残す。
 */
describe('狭い幅で操作が隠れない', () => {
  it('吹き出しは共通 composer で幅を縮め、操作の幅を保つ', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../shared/message-composer.module.css'), 'utf8')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('flex-shrink: 0')
    expect(FORM).toContain('<MessageComposer')
  })

  it('メッセージの段の列は狭い幅でも縮む', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form-v8.module.css'), 'utf8')
    expect(css).toContain('.input { min-width: 0;')
    expect(css).toContain('@container broadcast-create (width < 1100px)')
  })
})
