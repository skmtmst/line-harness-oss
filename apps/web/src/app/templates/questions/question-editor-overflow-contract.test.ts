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
    // B-169: 共通の行を縦に開き、対象の選ぶ欄と値の入力を分ける。
    expect(EDITOR).toContain('<EntityPickerField label="友だち情報欄"')
    expect(EDITOR).toContain('<TextField aria-label="友だち情報欄に書き込む値"')
    expect(EDITOR).not.toContain('const selectClass =')
  })

  it('タグの選択欄は全幅の独立した行で、長いタグ名でカードを広げない', () => {
    // U022: タグの選択は全幅の独立行。選ぶ窓の欄（1行・名前は省略表示）を札の行と分けて置く。
    expect(EDITOR).toContain('<ActionList<Effect>')
    expect(EDITOR).toContain('<EntityPickerField label="タグ" noun="タグ" items={tags} multiple')
    expect(EDITOR).not.toContain('<select')
  })
})
