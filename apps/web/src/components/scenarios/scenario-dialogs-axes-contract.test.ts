/*
 * R238: 配信条件の窓に並べるのは、実際に追加ボタンがある条件だけ。
 *
 * 「利用できる」と書いたのに追加操作が無い軸（イベント予約・担当者など）
 * があると、無い操作を探し続けることになる。並び・名前は ConditionBuilder
 * の追加ボタン（RULE_KINDS）と同じにし、ずれたらこの試験が赤くなる。
 * ConditionBuilder は共有部品なので触らず、こちら側の案内だけを直す。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SCENARIOS = path.join(import.meta.dirname)
const SHARED = path.join(import.meta.dirname, '..', 'shared')

const dialogs = fs.readFileSync(path.join(SCENARIOS, 'scenario-dialogs.tsx'), 'utf8')

function ruleKindLabels(): string[] {
  const builder = fs.readFileSync(path.join(SHARED, 'condition-builder.tsx'), 'utf8')
  const start = builder.indexOf('const RULE_KINDS')
  // 配列の閉じは行頭の `]`（中の make 関数の閉じ括弧と区別する）。
  const end = builder.indexOf('\n]', start)
  const block = builder.slice(start, end)
  return [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
}

function axisSection(): string {
  const start = dialogs.indexOf('足せる条件')
  return dialogs.slice(start, dialogs.indexOf('</section>', start))
}

function dialogAxisLabels(): string[] {
  return [...axisSection().matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('R238: 案内の条件と追加ボタンの条件が一致する', () => {
  it('足せない軸を利用可能と書かない', () => {
    const section = axisSection()
    expect(dialogs).not.toContain('利用できる条件軸')
    for (const missing of ['イベント予約', 'カレンダー予約', '共通情報', 'リマインダ', '担当者', '流入経路', '配信状況', '予約状況', '購入履歴']) {
      expect(section).not.toContain(missing)
    }
  })

  it('案内の並び・名前は追加ボタンと同じ', () => {
    expect(dialogAxisLabels()).toEqual(ruleKindLabels())
  })
})
