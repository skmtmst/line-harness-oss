import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR = readFileSync(
  join(HERE, '..', '..', '..', 'v8', 'tags', 'mark-editor.tsx'),
  'utf8',
)
const CSS = readFileSync(join(HERE, '..', '..', '..', 'v8', 'tags', 'create.module.css'), 'utf8')
const BASIC = readFileSync(join(HERE, '..', '..', '..', 'v8', 'tags', 'mark-basic-fields.tsx'), 'utf8')

/*
 * #973 U020/U021: 対応マークの作成カード（/tags/marks/new）は
 * 390px・320px で右端が切れていた。
 *
 * - U020: 基本情報カードの右端と「最初から付ける」のチェックが切れる
 * - U021: 自動変更ルールの「きっかけ → 変更先」が横並びで潰れる
 */
describe('対応マーク作成のはみ出し（#973 U020/U021）', () => {
  it('U020: 現役の入力と色の欄は狭い幅でも縮める', () => {
    expect(EDITOR).toContain('<CreatePage')
    expect(BASIC).toContain('className={styles.colorField}')
    expect(CSS).toMatch(/\.input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/)
    expect(CSS).toMatch(/\.colorField\s*\{[^}]*min-width:\s*0;/)
  })

  it('U020: 説明文とチェック欄を1行に押し込まない', () => {
    // チェックは説明文の右端に吊るさず、文の下の行に置く。
    expect(EDITOR).not.toContain('items-center justify-between gap-3 border-t border-hairline')
    expect(EDITOR).toContain('最初から付けるマークは1つだけ選べます')
  })

  it('U021: 作成のきまりは縦の欄と全幅の選択で変更先を示す', () => {
    // 横並びの → は消え、縦配置の ↓（aria-hidden）になる。
    // きっかけの欄は共通 Select（全幅）。素の select は置かない。
    expect(EDITOR).toContain('<Select')
    expect(EDITOR).toContain('aria-label="きっかけ"')
    expect(EDITOR).toContain('size="full"')
    expect(EDITOR).not.toContain('<select')
    expect(CSS).toMatch(/\.ruleForm\s*\{[^}]*flex-direction:\s*column;/)
    expect(EDITOR).toContain("→ 「${name || 'このマーク'}」に変える")
    expect(CSS).toMatch(/\.ruleWhen\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/)
  })
})
