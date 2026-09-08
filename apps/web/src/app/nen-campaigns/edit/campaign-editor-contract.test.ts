import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(path.join(__dirname, 'campaign-editor.tsx'), 'utf8')

describe('相手検索の失敗対応(点検 #512 の中7)', () => {
  it('検索の呼び出しをtry/catchで受け、失敗時はnoticeを出す', () => {
    const start = EDITOR.indexOf('const searchFriends')
    expect(start >= 0, 'searchFriends がない').toBe(true)
    const block = EDITOR.slice(start, start + 1200)
    expect(block).toContain('try {')
    expect(block).toContain('catch {')
    expect(block).toContain('setNotice(')
  })

  it('失敗文言は次にすることが分かる書き方にする', () => {
    expect(EDITOR).toContain('相手を探せませんでした')
  })
})
