import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 外部連携「やり取りの記録」の禁止の見張り。読み込み・空・失敗、期間を書いた補足、結果不明の送り直し、
 * やり直せる範囲の説明、技術的な記録、アカウント切替は v8/webhooks/interactions-behavior.test.tsx と
 * interactions-v8-react.test.tsx が画面と口の呼び出しで確かめる。タブの件数は webhook-tab-counts.test.tsx。
 */
const PAGE = readUiSource(join(import.meta.dirname, '../../v8/webhooks/interactions.tsx'), 'utf8')
const HOST = readUiSource(join(import.meta.dirname, 'page.tsx'), 'utf8')

describe('V8 外部連携・やり取りの記録 Uv9AA', () => {
  it('タブの件数に設計の作り物の数を書かない(#980)', () => {
    expect(HOST).not.toContain("'こちらから送る 6'")
    expect(HOST).not.toContain("'こちらで受け取る 3'")
    expect(HOST).not.toContain("'見本 14'")
  })

  it('送受信の本文を記録の窓へ持ち込まない(IDEA-26)', () => {
    expect(PAGE).not.toContain('request_body_json')
    expect(PAGE).not.toContain('requestBodyJson')
  })

  it('本文に画面タイトルや説明を重ねない', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })
})
