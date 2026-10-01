// @vitest-environment happy-dom
import React from 'react'
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

/*
 * R236: 送信後を「ここで一時停止する」にしても、右の設定サマリーの
 * 「配信後」だけが「次のステップへ進む」のまま残っていた。設定内容の
 * 札（送信後に一時停止）と食い違う。直しを戻す（配信後を固定表示に
 * 戻す）と、この試験は赤くなる。
 */
import StepPreview from './step-preview'

afterEach(() => {
  cleanup()
})

const base = {
  deliveryMode: 'elapsed' as const,
  offsetDays: 1,
  deliveryTime: '09:00',
  offsetHours: 0,
  offsetMinutes: 0,
  kind: 'text' as const,
  templateName: null,
  body: '本文',
  imageUrl: null,
  question: null,
  audienceLabel: '購読中の全員',
}

/** 設定サマリーの「配信後」の値だけを拾う（設定内容の札と混ざらないように）。 */
function summaryAfterSend(): string | null {
  const aside = screen.getByRole('complementary', { name: '1通目の下見' })
  const rows = [...aside.querySelectorAll('dl div')]
  const row = rows.find((el) => el.querySelector('dt')?.textContent === '配信後')
  return row?.querySelector('dd')?.textContent ?? null
}

describe('R236: 設定サマリーの配信後は送信後の設定に付いていく', () => {
  it('一時停止にすると「送信後に一時停止」になる', () => {
    render(<StepPreview {...base} afterSend="pause" />)
    expect(summaryAfterSend()).toBe('送信後に一時停止')
  })

  it('省略時・次へ進むときは「次へ進む」になる', () => {
    render(<StepPreview {...base} />)
    expect(summaryAfterSend()).toBe('次へ進む')
    cleanup()
    render(<StepPreview {...base} afterSend="continue" />)
    expect(summaryAfterSend()).toBe('次へ進む')
  })
})
