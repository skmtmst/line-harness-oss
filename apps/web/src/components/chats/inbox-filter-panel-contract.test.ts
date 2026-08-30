import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'inbox-filter-panel.tsx'),
  'utf8',
)

/** 受信箱の絞り込み（設計 `w72a2` 2-12）。 */
describe('受信箱の絞り込み', () => {
  it('設計の6項目をすべて置く', () => {
    for (const label of ['対応マーク', '担当者', '受信経路', '期限', 'メッセージ種別', '未読だけ']) {
      expect(PANEL).toContain(label)
    }
  })

  it('押せないときに理由を書く', () => {
    /*
     * 「まだ絞り込めません」だけだと、自分の権限の問題なのか、設定が
     * 要るのか、まだ無いのかが分からない。
     */
    expect(PANEL).not.toMatch(/>まだ絞り込めません</)
    expect(PANEL).toContain('期限はまだ記録していないため')
    expect(PANEL).toContain('種別で絞る読み口がまだ無いため')
  })
})
