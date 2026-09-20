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
    const selectClass = EDITOR.match(/const selectClass =\s*'([^']+)'/)
    expect(selectClass, 'selectClass が見つからない').not.toBeNull()
    expect(selectClass![1]).toContain('min-w-0')
    expect(selectClass![1]).toContain('max-w-full')
  })

  it('友だち情報欄は選択と値を同じ行に押し込まない', () => {
    // ラベル・選択・値は全幅の縦配置。横並びの flex 行ではない。
    const block = EDITOR.match(/友だち情報欄<\/span>[\s\S]{0,1600}?セットする値（既存の値は上書き）/)
    expect(block, '友だち情報欄のブロックが見つからない').not.toBeNull()
    expect(block![0]).not.toContain('flex flex-wrap items-center')
    expect(block![0]).toContain('w-full')
  })

  it('タグの選択欄は全幅の独立した行で、長いタグ名でカードを広げない', () => {
    const tagSelect = EDITOR.match(/aria-label=\{label\}[\s\S]{0,600}?className="([^"]+)"/)
    expect(tagSelect, 'タグ選択欄が見つからない').not.toBeNull()
    expect(tagSelect![1]).toContain('w-full')
    expect(tagSelect![1]).toContain('max-w-full')
  })
})
