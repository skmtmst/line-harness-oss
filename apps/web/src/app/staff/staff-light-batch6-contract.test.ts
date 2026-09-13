import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PERMISSION_LABELS } from './permission-labels'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const NEW_PAGE = fs.readFileSync(path.join(__dirname, 'new', 'page.tsx'), 'utf8')

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} が見つからない`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${to} が見つからない`).toBeGreaterThan(a)
  return src.slice(a + from.length, b)
}

/** サーバー・追加画面と同じ1行正規表現の文字。 */
const EMAIL_PATTERN = String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

describe('ログインユーザーの軽修正(#581)', () => {
  it('編集窓が追加画面・サーバーと同じ形式チェックを先に行う', () => {
    const body = slice(PAGE, 'const save = async () => { if (!email.trim())', 'await onSaved(); onClose()')
    expect(body, '形式チェックが無い').toContain(`if (!${EMAIL_PATTERN}.test(email.trim()))`)
    expect(body, '文言がサーバーと違う').toContain("setError('正しいメールアドレスを入力してください')")
    expect(NEW_PAGE, '追加画面の形式チェックが変わっている').toContain(`!${EMAIL_PATTERN}.test(email.trim())`)
  })

  it('設計の言葉「2段階の確認」を変えていない(設計が正本、#581)', () => {
    expect(PAGE, '設計の言葉が消えている').toContain('2段階の確認')
  })

  it('権限の表示名は正本の表とずれない', () => {
    const editPaths = slice(PAGE, 'const EDIT_PERMISSION_PATHS = [', '] as const')
      .split(',')
      .map((item) => item.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    expect(editPaths.length, '編集窓の顔ぶれが変わっている').toBe(21)
    for (const key of editPaths) {
      expect(PERMISSION_LABELS[key], `${key} の表示名が正本に無い`).toBeTruthy()
    }
    const groupBlock = slice(NEW_PAGE, 'const PERMISSION_GROUPS = [', '] as const')
    const pairs = [...groupBlock.matchAll(/\['([^']+)', '([^']+)'\]/g)]
    expect(pairs.length, '追加画面の分類表が読めない').toBeGreaterThan(21)
    for (const [, key, label] of pairs) {
      expect(PERMISSION_LABELS[key], `${key} が正本に無い`).toBe(label)
    }
    expect(Object.keys(PERMISSION_LABELS).length, '正本の件数が変わっている').toBe(28)
  })
})
