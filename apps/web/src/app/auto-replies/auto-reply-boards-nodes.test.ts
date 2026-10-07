import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const WIZARD = readFileSync(join(HERE, 'edit', 'wizard-v8.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 *
 * 一覧（G8i4xP・Q5lOCc・WPrd5）の見張りは、もう描かれない `list-v8.tsx` を読んでいたので
 * 2026-10-06 に外付けSSDの Archive/line-harness-tests-20261006 へ移した。
 */
describe('自動応答の残りの板ID', () => {
  it('編集の競合に UGrd2 の帯と比較み・読み込みが出る', () => {
    // 帯・比べる窓は共通の save-conflict に寄せた（2026-10-07）。文言・ボタンは共通部品が持つ。
    expect(WIZARD).toMatch(/<SaveConflictBand[\s\S]{0,200}designNode="UGrd2"/)
    expect(WIZARD).toContain('onCompare={() => void openCompare()}')
    expect(WIZARD).toContain('<SaveConflictCompareDialog')
    expect(WIZARD).toContain('describeAutoReplyDiff')
  })

  it('作る②の狭い幅が Z2LIUx になる', () => {
    expect(WIZARD).toContain("step === 'trigger' && narrow ? 'Z2LIUx'")
  })
})
