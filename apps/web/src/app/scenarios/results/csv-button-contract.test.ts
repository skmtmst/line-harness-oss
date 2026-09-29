import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 注釈を落とす。直した理由の文が、自分の見張りに当たらないように。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 横断レビュー §7 の #44「CSVの置き場が3通り」。
 *
 * 実装でCSV書き出しを持つ8画面のうち、**ここだけが主要ボタン（緑）**だった。
 * この画面でいちばんしたいことは結果を見ることで、CSVに落とすことではない。
 */
describe('シナリオ結果のCSV書き出し', () => {
  it('主要ボタンにしない', () => {
    const line = code(PAGE).split('\n').find((l) => l.includes('CSVで書き出す'))
    expect(line, 'CSVで書き出すボタンが見つからない').toBeDefined()
    expect(line, '緑の主要ボタンにしない').not.toContain('variant="primary"')
  })
})
