import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR = readFileSync(
  join(HERE, '..', '..', '..', 'components', 'scenarios', 'question-editor.tsx'),
  'utf8',
)

/*
 * #973 U022: 質問の詳しい設定（/templates/questions/new）を開くと、
 * タグ・文字数・テキストの右端がカードの外へ切れていた。
 * ネイティブ select は最長 option の幅まで広がるのが主因。
 */
describe('質問エディタのはみ出し（#973 U022）', () => {
  it('select はコンテナ幅を上限にし、狭い行では縮む', () => {
    // 選び欄は共通 Select。幅は部品の size="full"（親いっぱい）で持たせ、
    // 最長選択肢まで広がる素の select と selectClass の上書きは置かない。
    expect(EDITOR).not.toMatch(/const selectClass =/)
    expect(EDITOR).not.toContain('<select')
    expect(EDITOR).toContain('size="full"')
  })

  it('友だち情報欄は選択と値を同じ行に押し込まない', () => {
    // ラベル・選択・値は全幅の縦配置。横並びの flex 行ではない。
    // 2026-09-25: 見出しの span を label へ（読み上げ対応）。見張りは配置のまま。
    // 選び欄は共通 Select の size="full"、値は w-full の入力欄
    // （placeholder と className の順で置くため、値は別に見張る）。
    const block = EDITOR.match(/友だち情報欄<\/(span|label)>[\s\S]{0,1600}?セットする値（既存の値は上書き）/)
    expect(block, '友だち情報欄のブロックが見つからない').not.toBeNull()
    expect(block![0]).not.toContain('flex flex-wrap items-center')
    expect(block![0]).toContain('size="full"')
    const valueInput = EDITOR.match(/友だち情報欄にセットする値[\s\S]{0,1200}?w-full/)
    expect(valueInput, '値の入力欄が全幅でない').not.toBeNull()
  })

  it('タグの選択欄は全幅の独立した行で、長いタグ名でカードを広げない', () => {
    // U022: タグの選択は全幅の独立行。共通 Select の size="full" で持たせる。
    const tagSelect = EDITOR.match(/aria-label=\{label\}[\s\S]{0,600}?size="full"/)
    expect(tagSelect, 'タグ選択欄が見つからない').not.toBeNull()
  })
})
