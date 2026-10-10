import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit-v8.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('テンプレートの残りの板ID', () => {
  it('状態の4場面に susGP が付く', () => {
    const count = LIST.split('data-design-node="susGP"').length - 1
    expect(count).toBe(3)
  })

  it('見るだけの人に hEDTK の帯が出る', () => {
    expect(LIST).toMatch(/(?:data-design-node|boardId)="hEDTK"/)
    expect(LIST).toContain('<ReadOnlyNotice')
    expect(LIST).toMatch(/!canMutateTemplates[\s\S]*?data-design-node="hEDTK"/)
  })

  it('狭い幅で一覧が L7zA7C になる', () => {
    expect(LIST).toContain("boardId={narrow ? 'L7zA7C' : 'v19Ivv'}")
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('編集の競合に NCbYn の帯と比較み・読み込みが出る', () => {
    // 帯・比べる窓は共通の save-conflict に寄せた（2026-10-07）。文言・ボタンは共通部品が持つ。
    expect(EDIT).toContain('<SaveConflictBand')
    expect(EDIT).toContain('designNode="NCbYn"')
    expect(EDIT).toContain('onCompare={openCompare}')
    expect(EDIT).toContain('<Dialog')
    expect(EDIT).toContain('比べてから保存')
    expect(EDIT).toContain('describeTemplateDiff')
  })
})
