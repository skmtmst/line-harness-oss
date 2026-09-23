// @vitest-environment happy-dom
/*
 * INBOX-04(#617): 受信箱の絞り込みパネルで「受信経路」が1回の操作で
 * 候補を展開する。
 *
 * 以前は素の `<select>` で、開いた候補は OS 側の描画のため画面（DOM）に
 * 現れなかった。実機監査は「1回操作しても候補が展開せず画面変化もない」
 * としか観測できない。候補を DOM へ描く共通の Select へ換えたことを、
 * 実物の InboxFilterPanel をマウントして確かめる。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import InboxFilterPanel, { type InboxFilterValue } from './inbox-filter-panel'

const baseValue: InboxFilterValue = {
  status: 'all',
  assignee: 'all',
  channel: 'all',
  unreadOnly: false,
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('受信経路の選択欄(INBOX-04)', () => {
  test('1回の操作で候補がDOMへ展開する', async () => {
    await act(async () => {
      render(
        <InboxFilterPanel
          open
          value={baseValue}
          operators={[]}
          onChange={() => {}}
          onReset={() => {}}
          onClose={() => {}}
        />,
      )
    })

    const trigger = screen.getByRole('button', { name: '受信経路で絞り込む' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // 展開前は候補がDOMに無い。
    expect(screen.queryByRole('listbox')).toBeNull()

    // **1回の操作**だけで候補が展開しなければならない。
    await act(async () => {
      trigger.click()
    })

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const listbox = screen.getByRole('listbox')
    const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('LINE・MAIL'),
      expect.stringContaining('LINE'),
      expect.stringContaining('MAIL'),
    ])
  })

  test('候補を選ぶと onChange へ反映されて畳まれる', async () => {
    const onChange = vi.fn()
    await act(async () => {
      render(
        <InboxFilterPanel
          open
          value={baseValue}
          operators={[]}
          onChange={onChange}
          onReset={() => {}}
          onClose={() => {}}
        />,
      )
    })

    await act(async () => {
      screen.getByRole('button', { name: '受信経路で絞り込む' }).click()
    })
    const line = screen
      .getAllByRole('option')
      .find((option) => option.textContent === 'LINE')!
    await act(async () => {
      line.querySelector('button')!.click()
    })

    expect(onChange).toHaveBeenCalledWith({ ...baseValue, channel: 'line' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
