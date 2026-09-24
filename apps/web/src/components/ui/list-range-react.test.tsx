// @vitest-environment happy-dom
/*
 * ListRange（監査6 #667）を本物のReactで動かす試験。
 *
 * 画面ごとにバラバラだった一覧の件数表示を「N件中 X〜Y件を表示」
 * の1形へ寄せる部品。見るのは正形、0件、件名の前置きの3点。
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import ListRange from './list-range'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ListRange（監査6 #667: 件数表示の統一）', () => {
  it('「N件中 X〜Y件を表示」の1形だけを出す', () => {
    render(<ListRange total={1234} first={1} last={20} />)
    expect(screen.getByText('1,234件中 1〜20件を表示')).toBeTruthy()
  })

  it('0件のときは「0〜0件」を出さず「0件」', () => {
    const { container } = render(<ListRange total={0} first={0} last={0} />)
    expect(container.textContent).toBe('0件')
    expect(container.textContent).not.toContain('〜0件')
  })

  it('label は件名として前に付く', () => {
    render(<ListRange label="記録" total={5} first={1} last={5} />)
    expect(screen.getByText('記録 5件中 1〜5件を表示')).toBeTruthy()
  })

  it('1ページ分しかなくても件数自体は同じ形で出す（ページ送りは含まない）', () => {
    render(<ListRange total={2} first={1} last={2} />)
    expect(screen.getByText('2件中 1〜2件を表示')).toBeTruthy()
  })
})
