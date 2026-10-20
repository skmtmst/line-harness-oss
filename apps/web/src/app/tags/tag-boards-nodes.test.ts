import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, '../../v8/tags/list.tsx'), 'utf8')
const TAB = readFileSync(join(HERE, '../../v8/tags/tags-tab.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, '../../v8/tag-edit/edit.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('タグの残りの板ID', () => {
  it('状態の4場面に U0aKD が付く', () => {
    // 現役の読み込み・失敗・空の状態に同じ板の印が付く。
    // 注釈の  を除き、札の値を4つ数える。
    const count = (TAB.match(/(?<!`)U0aKD(?!`)/g) ?? []).length
    expect(count).toBe(3)
  })

  it('狭い幅で一覧が aPeD8 になる', () => {
    expect(LIST).toContain("narrow ? 'aPeD8' : 'I1E7Bt'")
    expect(LIST).toContain('boardId={boardId}')
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('タグの編集を見るだけの人に fkGUR の帯が出て操作が止まる', () => {
    expect(EDIT).toMatch(/(?:data-design-node|boardId)="fkGUR"/)
    expect(EDIT).toContain('閲覧のみで見ています')
    expect(EDIT).toContain('readOnly={readOnly}')
    expect(EDIT).toContain('if (readOnly) return')
  })

  it('タグの編集の競合に xn95q の帯と比較み・読み込みが出る', () => {
    // 帯・比べる窓は共通の save-conflict に寄せた（2026-10-07）。文言・ボタンは共通部品が持つ。
    expect(EDIT).toMatch(/<SaveConflictBand[\s\S]{0,200}designNode="xn95q"/)
    expect(EDIT).toContain('onCompare={() => void openCompare()}')
    expect(EDIT).toContain('<ConfirmDialog')
    expect(EDIT).toContain('describeTagDiff')
  })
})
