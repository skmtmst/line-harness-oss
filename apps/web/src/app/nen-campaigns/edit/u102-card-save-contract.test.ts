import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
)

/*
 * #975 U102: /nen-campaigns/edit ではコラムごとに高さのある固定保存帯が
 * 付き、スマホでは紹介文より保存帯のほうが目立っていた。
 * カード内の1行（見出し＋状態＋保存）へ置き換える。
 */
describe('コラムごとの保存を1行へ（#975 U102）', () => {
  it('カード内に見出し・状態・保存ボタンの1行がある', () => {
    expect(PAGE).toContain("drafts[column.id] ?? '') !== (column.introText ?? '')")
    expect(PAGE).toContain('savingId === column.id')
    expect(PAGE).toContain('この紹介文を保存しました')
    expect(PAGE).toContain('変更があります。保存するまで反映されません')
  })

  it('コラムごとの大きな固定保存帯は使わない', () => {
    // 取り込み（import）も JSX も残さない。説明のコメント中の言及は許す。
    expect(PAGE).not.toContain('sticky-bar')
    expect(PAGE).not.toContain('<StickyBar')
  })
})
