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

describe('本文の上限統一（#659）', () => {
  it('画面と保存で同じ上限・数え方を使う', () => {
    expect(EDITOR).toContain('NEN_CAMPAIGN_BODY_MAX_LENGTH')
    expect(EDITOR).toContain('checkNenCampaignBodyLength')
    expect(EDITOR).toContain("from '@line-crm/shared'")
  })

  it('入力欄に文字数の上限を固定しない（超過時も内容を保持できる）', () => {
    expect(EDITOR).not.toMatch(/<textarea[^>]*maxLength/)
  })

  it('入力中に残数と理由を表示する', () => {
    expect(EDITOR).toContain('あと')
    expect(EDITOR).toContain('長すぎるとLINEで送れません')
  })

  it('上限超過時は理由を表示し、保存させない', () => {
    expect(EDITOR).toContain('を超えています')
    expect(EDITOR).toContain('入力内容はそのまま残っています')
    expect(EDITOR).toContain('disabled={saving || !bodyCheck.fits}')
  })

  it('差し込み展開後に長すぎる恐れがあるときは注意を出す', () => {
    expect(EDITOR).toContain('expandedFits')
    expect(EDITOR).toContain('差し込む名前が長いと')
  })

  it('保存失敗時はサーバーの理由を利用者に見せる', () => {
    expect(EDITOR).toContain('ApiError')
  })
})
