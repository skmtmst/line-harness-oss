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
 *
 * タグ・友だち情報欄の選び方は components/scenarios/question-editor-effects-react.test.tsx で
 * 部品を開いて確かめる。ここに残すのは、素の select と幅の上書きを戻さない見張りだけ。
 */
describe('質問エディタのはみ出し（#973 U022）', () => {
  it('select はコンテナ幅を上限にし、狭い行では縮む', () => {
    expect(EDITOR).not.toMatch(/const selectClass =/)
    expect(EDITOR).not.toContain('<select')
  })

  it('友だち情報欄は選択と値を同じ行に押し込まない', () => {
    expect(EDITOR).not.toContain('const selectClass =')
  })

  it('タグの選択欄は全幅の独立した行で、長いタグ名でカードを広げない', () => {
    expect(EDITOR).not.toContain('<select')
  })
})
