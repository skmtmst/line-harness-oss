import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 管理画面 リッチメニューの削除確認。
 * 共通の確認窓・取り込みの確認と結果・遅れた取り込み結果・取り下げ・失敗時の文は
 * v8/rich-menus/list-delete-import-react.test.tsx が押して見る。
 * ここにはブラウザ標準の窓と内部IDを出さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')

describe("管理画面 リッチメニュー削除確認 szXsT", () => {
  it('ブラウザ標準の confirm を使わない', () => {
    expect(PAGE.match(/\bconfirm\(/g) ?? []).toHaveLength(0)
  })

  it('公開中のメニューの削除を alert の文で済ませない', () => {
    expect(PAGE).not.toContain('「${group.name}」は LINE に登録されています。\\n\\n')
  })

  it('内部の ID を利用者に見せない', () => {
    expect(PAGE).not.toContain('(richMenuId:')
  })
})
