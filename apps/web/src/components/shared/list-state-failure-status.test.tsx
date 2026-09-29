import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import ListState from './list-state'
import TargetMissing from './target-missing'
import { TableStateRow } from './table'

/**
 * 読み込み失敗の1枚で 403 と 429 を言い分ける（m23m）。
 *
 * 403 は押しても直らないので再試行の口を出さず、権限の案内にする。
 * 429 は待ち秒数（Retry-After があれば使う）を添え、再試行は残す。
 * 画面は捕まえた失敗を `error` に渡すだけで済む。
 */
describe('失敗の1枚の403・429出し分け', () => {
  it('403は権限の案内にし、再試行の口を出さない', () => {
    const html = renderToStaticMarkup(
      <ListState kind="error" error={new ApiError(403, 'API error: 403')} onRetry={vi.fn()} />,
    )
    expect(html).toContain('権限がありません')
    expect(html).not.toContain('もう一度読み込む')
    expect(html).not.toContain('<button')
  })

  it('429は混み合いと待ち秒数を出し、再試行の口は残す', () => {
    const html = renderToStaticMarkup(
      <ListState
        kind="error"
        error={new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30)}
        onRetry={vi.fn()}
      />,
    )
    expect(html).toContain('混み合')
    expect(html).toContain('30秒')
    expect(html).toContain('もう一度読み込む')
  })

  it('429で秒数が無くても待ち案内は出す', () => {
    const html = renderToStaticMarkup(
      <ListState kind="error" error={new ApiError(429, 'API error: 429')} onRetry={vi.fn()} />,
    )
    expect(html).toContain('少し待って')
  })

  it('それ以外の失敗は今までどおり再試行の口を出す', () => {
    const html = renderToStaticMarkup(
      <ListState kind="error" error={new ApiError(500, 'API error: 500')} onRetry={vi.fn()} />,
    )
    expect(html).toContain('表示できませんでした')
    expect(html).toContain('もう一度読み込む')
  })

  it('画面の指定した文言はそのまま使う', () => {
    const html = renderToStaticMarkup(
      <ListState
        kind="error"
        title="成果地点を読み込めませんでした"
        description="独自の案内"
        error={new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30)}
        onRetry={vi.fn()}
      />,
    )
    expect(html).toContain('成果地点を読み込めませんでした')
    expect(html).toContain('独自の案内')
  })

  it('開き先が無い1枚（TargetMissing）も403で再試行を出さない', () => {
    const html = renderToStaticMarkup(
      <TargetMissing
        kind="error"
        title="表示できませんでした"
        description="案内"
        error={new ApiError(403, 'API error: 403')}
        onRetry={vi.fn()}
      />,
    )
    expect(html).toContain('表示できませんでした')
    expect(html).not.toContain('<button')
  })

  it('表の中の1行も403で再試行を出さず、429で待ち案内を出す', () => {
    const forbidden = renderToStaticMarkup(
      <table><tbody>
        <TableStateRow colSpan={2} kind="error" error={new ApiError(403, 'API error: 403')} onRetry={vi.fn()} />
      </tbody></table>,
    )
    expect(forbidden).toContain('権限がありません')
    expect(forbidden).not.toContain('<button')

    const limited = renderToStaticMarkup(
      <table><tbody>
        <TableStateRow
          colSpan={2}
          kind="error"
          error={new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30)}
          onRetry={vi.fn()}
        />
      </tbody></table>,
    )
    expect(limited).toContain('混み合')
    expect(limited).toContain('30秒')
    expect(limited).toContain('<button')
  })
})
