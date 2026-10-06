import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(join(HERE, relative), 'utf8')

/*
 * V8-B オートメーション3板（`LWQXd` 一覧・`J1VA8` 下書きを仕上げる・
 * `c7dxp` 見本12件）。F-14〜F-16 の口が入ったので、絵どおりに作り直した
 * V8 の枝の外枠に `data-design-node` を付ける。v7 は変えない。
 */
describe('V8 オートメーション3板の印', () => {
  it('一覧の外枠に LWQXd を付ける', () => {
    const list = read('list-v8.tsx')
    expect(list, '一覧の板が無い').toContain('data-design-node="LWQXd"')
  })

  it('一覧の行の操作に「1人で試す」を置く（F-14 担当へ知らせるの動作確認口）', () => {
    const list = read('list-v8.tsx')
    expect(list, '1人で試すが無い').toContain('1人で試す')
  })

  it('下書き仕上げの外枠に J1VA8 を付ける', () => {
    const draft = read('drafts/draft-v8.tsx')
    expect(draft, '下書き仕上げの板が無い').toContain('data-design-node="J1VA8"')
  })

  it('下書き仕上げに「1人で試す」を置く（F-15）', () => {
    const draft = read('drafts/draft-v8.tsx')
    expect(draft, 'F-15 の試しが無い').toContain('1人で試す')
  })

  it('見本の外枠に c7dxp を付ける', () => {
    const templates = read('templates-v8.tsx')
    expect(templates, '見本の板が無い').toContain('data-design-node="c7dxp"')
  })

  it('見本は口の実データから12件出す（F-16）。絵の数は書かない', () => {
    const templates = read('templates-v8.tsx')
    expect(templates, '再読み込みが無い').toContain('見本を再読み込み')
    expect(templates, '絞り込みが無い').toContain('きっかけ')
  })
})
