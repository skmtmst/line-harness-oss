import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/*
 * 監査 m22j ついで: ほかの一覧と同じく、行の赤いゴミ箱ではなく
 * 「…」の中の「削除する」（確認つき）にそろえる（LAY-18）。
 */
describe('スコアのルールの削除（m22j）', () => {
  it('行の削除は共通の RowActions の「…」の中へ入れる', () => {
    expect(PAGE).toContain("import { RowActions } from '@/components/shared/row-actions'")
    expect(PAGE).toContain('destructiveItem={')
    expect(PAGE).toContain("label: '削除する'")
    // 行に赤いゴミ箱ボタンを直接置かない。
    expect(PAGE).not.toContain('を削除`} onClick={() => removeRule(index)}')
    expect(PAGE).not.toContain('<Trash2')
  })

  it('削除は確認を出してから消す', () => {
    // 「…」→「削除する」はすぐ消さず、確認の窓へ対象の番号を渡す。
    expect(PAGE).toContain('onSelect: () => setDeleteRuleIndex(index)')
    expect(PAGE).toContain('open={deleteRuleIndex !== null}')
    expect(PAGE).toContain('を削除しますか？')
    expect(PAGE).toContain('confirmLabel="削除する"')
    expect(PAGE).toContain('destructive')
    // 確認して初めて消える。閉じただけでは残る。
    expect(PAGE).toContain('if (deleteRuleIndex !== null) removeRule(deleteRuleIndex)')
    expect(PAGE).toContain('onCancel={() => setDeleteRuleIndex(null)}')
  })

  it('行の配置は変えない（名前・点数・頻度・操作の並び）', () => {
    // U047 の幅の約束は保つ。操作の場所だけ「…」に入れ替える。
    expect(PAGE).toContain('col-span-1 justify-self-end')
  })
})
