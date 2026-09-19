import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR = readFileSync(
  join(HERE, '..', '..', '..', 'components', 'friend-fields', 'support-mark-editor.tsx'),
  'utf8',
)

/*
 * #973 U020/U021: 対応マークの作成カード（/tags/marks/new）は
 * 390px・320px で右端が切れていた。
 *
 * - U020: 基本情報カードの右端と「最初から付ける」のチェックが切れる
 * - U021: 自動変更ルールの「きっかけ → 変更先」が横並びで潰れる
 */
describe('対応マーク作成のはみ出し（#973 U020/U021）', () => {
  it('U020: 3段グリッドの各カードは min-w-0 で縮める', () => {
    expect(EDITOR).toContain('xl:grid-cols-3')
    // グリッドの直接の子であるカードが3枚とも縮める印を持つ。
    const shrinkableCards = EDITOR.match(/<Card padding="default" className="min-w-0">/g) ?? []
    expect(shrinkableCards.length).toBeGreaterThanOrEqual(3)
  })

  it('U020: 説明文とチェック欄を1行に押し込まない', () => {
    // チェックは説明文の右端に吊るさず、文の下の行に置く。
    expect(EDITOR).not.toContain('items-center justify-between gap-3 border-t border-hairline')
    expect(EDITOR).toContain('最初から付けるマークは1つだけ選べます')
  })

  it('U021: きっかけと変更先は縦に並べ、矢印は飾りにする', () => {
    // 横並びの → は消え、縦配置の ↓（aria-hidden）になる。
    expect(EDITOR).toContain('w-full rounded-control border border-hairline bg-canvas px-3 text-sm font-semibold')
    expect(EDITOR).toMatch(/aria-hidden="true"[^>]*>\s*↓/)
    expect(EDITOR).toContain('「{name || \'このマーク\'}」に変更')
    // 変更先は折り返せる。長いマーク名でも行を広げない。
    expect(EDITOR).toContain('break-words rounded-control bg-surface-soft')
  })
})
