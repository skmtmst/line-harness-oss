import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')

/*
 * 削除の窓の動き（名前・失敗の理由・処理中・アカウント切替）は
 * v8/auto-replies/list-behavior.test.tsx が押して確かめる。
 * ここにはブラウザ標準の confirm へ戻さない禁止の見張りだけを残す。
 */
describe("管理画面 自動応答の削除確認 Gy9OK", () => {
  it('ブラウザ標準confirmへ戻さない', () => {
    expect(PAGE).not.toContain("confirm('このルールを削除しますか？')")
  })
})
