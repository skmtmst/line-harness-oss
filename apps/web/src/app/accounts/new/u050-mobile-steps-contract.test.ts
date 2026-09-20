import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
)

/*
 * #975 U050: アカウント登録（/accounts/new）では、スマホの初期画面に
 * 全5手順のカードが縦に積まれ、最初の入力欄までが長かった。
 *
 * 直し方: 640px 未満では「いまの手順＋全体の位置」だけを出し、
 * 全手順は開いて確認する。640px 以上ではこれまでどおり5段の帯。
 */
describe('アカウント登録の手順表示（#975 U050）', () => {
  it('狭い画面では現在の手順と位置だけを出し、全手順は開いて確認する', () => {
    expect(PAGE).toContain('sm:hidden')
    expect(PAGE).toContain('<details className="sm:hidden">')
    expect(PAGE).toContain('手順 {currentStep} / 5')
    expect(PAGE).toContain('全手順を見る')
  })

  it('広い画面ではこれまでどおり5段の帯を出す', () => {
    expect(PAGE).toContain('hidden gap-2 sm:grid sm:grid-cols-5')
    expect(PAGE).toContain('aria-label="登録の進捗"')
  })
})
