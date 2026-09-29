import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { IdentityStateBlock } from './identity-state'
import { failureOf } from './identity-view'

/**
 * M013：読み込み失敗面に再試行口がある。
 * 権限不足面には口を出さない（押しても直らないため）。
 */
describe('M013 本人照合の読み込み失敗の再試行口', () => {
  it('失敗面は再試行口を出し、押すと読み直す', () => {
    const onRetry = vi.fn()
    const html = renderToStaticMarkup(
      <IdentityStateBlock
        state="error"
        failure={failureOf(null)}
        emptyTitle="確認する候補はありません"
        emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
        onRetry={onRetry}
      />,
    )
    expect(html).toContain('もう一度読み込む')
  })

  it('権限不足面には再試行口を出さない', () => {
    const onRetry = vi.fn()
    const html = renderToStaticMarkup(
      <IdentityStateBlock
        state="forbidden"
        failure={failureOf({ status: 403 })}
        emptyTitle="確認する候補はありません"
        emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
        onRetry={onRetry}
      />,
    )
    expect(html).not.toContain('もう一度読み込む')
  })

  it('両画面が読み直しを結んでいる', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const friends = readFileSync(join(here, '..', '..', 'app', 'friends', 'identity-candidates', 'page.tsx'), 'utf8')
    const ec = readFileSync(join(here, '..', '..', 'app', 'ec-commerce', 'identity-candidates', 'page.tsx'), 'utf8')
    expect(friends).toContain('onRetry={review.reload}')
    // EC側は集計の読み直しも一緒に行う。
    expect(ec).toContain('onRetry={() => { void loadOperations(); review.reload() }}')
  })
})
