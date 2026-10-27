import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 外部連携の削除の禁止の見張り。確認窓・二度押し・失敗の言葉・アカウント切替は
 * v8/webhooks/overview-behavior.test.tsx が画面と口の呼び出しで確かめる。
 */
const incoming = readFileSync(new URL('../../v8/webhooks/incoming.tsx', import.meta.url), 'utf8')
const outgoing = readFileSync(new URL('../../v8/webhooks/outgoing.tsx', import.meta.url), 'utf8')
const pages = [incoming, outgoing]
describe('現役V8のWebhook削除確認', () => {
  it('ブラウザの confirm を使わず、口の生の失敗文を削除の失敗に出さない', () => {
    for (const src of pages) {
      expect(src).not.toMatch(/[^.\w]confirm\(/)
      expect(src).not.toMatch(/setDeleteError\(\s*(res\.error|String\()/)
    }
  })
})
