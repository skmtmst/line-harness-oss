import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(PAGE)

/**
 * 設計 `M0Gb7` は「予約サービス」「アンケートツール」のような**見本を選んで作る道**を持つ。
 * 実装は `sourceType` の自由入力だけで、置き文字の `line` しか手がかりが無かった。
 *
 * 保存する値は今までどおりの文字列なので、口も保存の形も変えていない。
 */
describe('外部連携の「どこから来るか」は、見本から選べる', () => {
  it('見本がひととおりある', () => {
    for (const label of ['LINE公式アカウント', '予約サービス', 'アンケートツール', 'ECサイト', '決済サービス']) {
      expect(CODE, `${label} の見本が無い`).toContain(`label: '${label}'`)
    }
  })

  it('見本ごとに、何を受け取るのかが書いてある', () => {
    expect(CODE).toContain("hint: '予約の確定・変更・取り消しを受け取ります'")
    expect(CODE).toContain('{selectedPreset.hint}')
  })

  it('自由入力の道も残っている', () => {
    expect(CODE).toContain("const SOURCE_OTHER = '__other__'")
    expect(CODE).toContain('その他（自分で書く）')
    expect(CODE).toContain('{sourceIsOther ?')
  })

  it('内部の語を見出しに出さない', () => {
    expect(CODE, '「ソースタイプ」が残っている').not.toContain('ソースタイプ')
    expect(CODE).toContain('どこから来るか')
  })

  it('未設定を半角ハイフンで書かない', () => {
    expect(CODE, "'-' のまま出している").not.toContain("wh.sourceType || '-'")
    expect(CODE).toContain("if (!value) return '—'")
  })
})
