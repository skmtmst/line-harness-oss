import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const WIZARD = readFileSync(join(HERE, 'edit', 'wizard-v8.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('自動応答の残りの板ID', () => {
  it('失敗・条件に合わない・未登録は状態の板、読込は遅延スケルトンを使う', () => {
    expect(LIST).toContain('data-design-node="G8i4xP"')
    expect(LIST).toContain('自動応答を読み込めませんでした')
    expect(LIST).toContain('条件に合うルールはありません')
    expect(LIST).toContain('まだ自動応答のルールはありません')
    expect(LIST).toContain('aria-busy="true" aria-label="読み込んでいます"')
    expect(LIST).toContain('<DelayedSkeleton loading skeleton={loadingSkeleton} />')
    expect(LIST).toContain("visibleLoadState === 'forbidden'")
    expect(LIST).toContain("visibleLoadState === 'error' && (")
  })

  it('見るだけの人に Q5lOCc の帯が出る', () => {
    expect(LIST).toContain('data-design-node="Q5lOCc"')
    expect(LIST).toContain('閲覧のみで見ています')
    // 帯は見るだけのときだけ。操作の押せない形は既存の canEdit が担う。
    expect(LIST).toContain('{!canEdit && (')
  })

  it('狭い幅で一覧が WPrd5 になる', () => {
    expect(LIST).toContain("data-design-node={narrow ? 'WPrd5' : undefined}")
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('編集の競合に UGrd2 の帯と比較み・読み込みが出る', () => {
    expect(WIZARD).toContain('data-design-node="UGrd2"')
    expect(WIZARD).toContain('違いを比べる')
    expect(WIZARD).toContain('最新を読み込んで続ける')
    expect(WIZARD).toContain('describeAutoReplyDiff')
  })

  it('作る②の狭い幅が Z2LIUx になる', () => {
    expect(WIZARD).toContain("step === 'trigger' && narrow ? 'Z2LIUx'")
  })
})
