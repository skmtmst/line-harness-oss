// @vitest-environment happy-dom
/*
 * ★V7 処理の進み（xiHO8）。
 * 4つの段階・読み上げ（role=progressbar と aria-valuenow、10% ごとの role=status）・
 * scaleX の伸び・止める／失敗のボタンの出し分けを見る。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Progress from './progress'

afterEach(() => cleanup())

describe('処理の進み（★V7 xiHO8）', () => {
  it('準備中は数が無い棒（aria-valuenow なし）で、背景処理の断りを出す', () => {
    render(<Progress state="preparing" title="送る準備をしています" note="宛先を数えています。この画面を閉じても止まりません。" />)
    const bar = screen.getByRole('progressbar', { name: '送る準備をしています' })
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByText('宛先を数えています。この画面を閉じても止まりません。')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('送信中は数・割合・残り時間を出し、止めるボタンは渡したときだけ出す', () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <Progress state="active" title="送っています" percent={62} countText="1,240 / 2,000 人" remainingText="あと約2分" />,
    )
    const bar = screen.getByRole('progressbar', { name: '送っています' })
    expect(bar.getAttribute('aria-valuenow')).toBe('62')
    expect(screen.getByText('62%')).not.toBeNull()
    expect(screen.getByText('1,240 / 2,000 人')).not.toBeNull()
    expect(screen.getByText('あと約2分')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '送るのを止める' })).toBeNull()

    rerender(
      <Progress state="active" title="送っています" percent={62} countText="1,240 / 2,000 人" onCancel={onCancel} />,
    )
    const stop = screen.getByRole('button', { name: '送るのを止める' })
    fireEvent.click(stop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('棒の伸びは幅ではなく scaleX（周りが揺れない）', () => {
    const { container } = render(<Progress state="active" title="送っています" percent={62} />)
    const track = [...container.querySelectorAll('[aria-hidden="true"]')].find((node) => node.tagName === 'DIV')
    const fill = track?.firstElementChild as HTMLElement | null
    expect(fill?.style.transform).toBe('scaleX(0.62)')
    expect(fill?.style.width).toBe('')
  })

  it('読み上げは 10% ごとに role=status で出す（62% と 63% は同じ文）', () => {
    const { rerender } = render(<Progress state="active" title="送っています" percent={62} />)
    expect(screen.getByRole('status').textContent).toBe('送っています 60%')
    rerender(<Progress state="active" title="送っています" percent={63} />)
    expect(screen.getByRole('status').textContent).toBe('送っています 60%')
    rerender(<Progress state="active" title="送っています" percent={70} />)
    expect(screen.getByRole('status').textContent).toBe('送っています 70%')
  })

  it('完了は印・文・満タンの棒の 3 つ（100 になる）', () => {
    render(<Progress state="done" title="2,000人に送りました" note="9月24日 10:32 に完了。既読は明日の朝から数えます。" />)
    const bar = screen.getByRole('progressbar', { name: '2,000人に送りました' })
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByText('9月24日 10:32 に完了。既読は明日の朝から数えます。')).not.toBeNull()
  })

  it('一部失敗は成功と失敗の数を両方言い、次の一手のボタンを出す', () => {
    const onSeeFailures = vi.fn()
    render(
      <Progress
        state="partial"
        title="1,988人に送り、12人に届きませんでした"
        percent={99.4}
        onSeeFailures={onSeeFailures}
        failuresLabel="届かなかった12人を見る"
      />,
    )
    const bar = screen.getByRole('progressbar', { name: '1,988人に送り、12人に届きませんでした' })
    expect(bar.getAttribute('aria-valuenow')).toBe('99')
    const next = screen.getByRole('button', { name: '届かなかった12人を見る' })
    fireEvent.click(next)
    expect(onSeeFailures).toHaveBeenCalledTimes(1)
  })

  it('割合は 0〜100 に収める', () => {
    const { rerender } = render(<Progress state="active" title="送っています" percent={140} />)
    expect(screen.getByRole('progressbar', { name: '送っています' }).getAttribute('aria-valuenow')).toBe('100')
    rerender(<Progress state="active" title="送っています" percent={-5} />)
    expect(screen.getByRole('progressbar', { name: '送っています' }).getAttribute('aria-valuenow')).toBe('0')
  })
})
