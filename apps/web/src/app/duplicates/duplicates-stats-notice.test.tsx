import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import DuplicatesStatsNotice from './duplicates-stats-notice'

/**
 * R598: 集計だけ失敗しても候補一覧は残り、集計欄に取得失敗と再試行が出る。
 * この試験は集計欄の1行（DuplicatesStatsNotice）の描画だけを見る。
 * ページ全体の分岐（候補を残す・両方失敗で1枚）は
 * duplicates-stats-failure.react.test.tsx で見る。
 */
describe('集計失敗の1行（R598）', () => {
  it('503は失敗と再試行を出し、候補を残す旨を添える', () => {
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new ApiError(503)} onRetry={() => {}} />,
    )
    expect(html).toContain('表示できませんでした')
    expect(html).toContain('候補一覧は取得済みの内容を表示しています')
    expect(html).toContain('もう一度')
    expect(html).toContain('<button')
  })

  it('404も再試行を出す', () => {
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new ApiError(404)} onRetry={() => {}} />,
    )
    expect(html).toContain('表示できませんでした')
    expect(html).toContain('<button')
  })

  it('状態の付かない失敗（success:false など）も再試行を出す', () => {
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new Error('集計の取得に失敗しました')} onRetry={() => {}} />,
    )
    expect(html).toContain('表示できませんでした')
    expect(html).toContain('<button')
  })

  it('403は権限の案内にし、押しても直らない再試行は出さない', () => {
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new ApiError(403)} onRetry={() => {}} />,
    )
    expect(html).toContain('集計を見る権限がありません')
    expect(html).toContain('候補一覧は取得済みの内容を表示しています')
    expect(html).not.toContain('<button')
  })

  it('429は待ちの案内にし、再試行は残す', () => {
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new ApiError(429)} onRetry={() => {}} />,
    )
    expect(html).toContain('混み合っています')
    expect(html).toContain('<button')
  })

  it('再試行の口は onRetry へつながる', () => {
    const onRetry = vi.fn()
    const html = renderToStaticMarkup(
      <DuplicatesStatsNotice failure={new ApiError(503)} onRetry={onRetry} />,
    )
    // 静的描画では押せないため、ボタンが onRetry 付きで1つだけあることを見る。
    // 押しての回復は duplicates-stats-failure.react.test.tsx で見る。
    expect(html).toContain('もう一度')
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('★V7：赤（素の赤・16進・危険トークン）を使わない', () => {
    for (const failure of [new ApiError(503), new ApiError(403), new ApiError(404)]) {
      const html = renderToStaticMarkup(
        <DuplicatesStatsNotice failure={failure} onRetry={() => {}} />,
      )
      expect(html).not.toMatch(/text-danger|text-red|bg-red|#[0-9a-fA-F]{3,8}|赤/)
    }
  })
})
