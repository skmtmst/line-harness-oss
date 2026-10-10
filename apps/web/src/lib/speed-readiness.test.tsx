// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import ListRange from '@/components/ui/list-range'
// @ts-expect-error JS measurement tool
import { screenReady } from '../../scripts/v8-guard/screen-ready.mjs'

afterEach(cleanup)
it('本物の件数表示と2,000行を、表示の言葉によらず完了と判定する', () => {
  document.documentElement.dataset.theme = 'v8'
  const { container } = render(<main>
    <ListRange total={2000} first={1} last={2000} />
    <table><tbody>{Array.from({ length: 2000 }, (_, i) => <tr key={i} data-friend-row><td>{i}</td></tr>)}</tbody></table>
  </main>)
  expect(screenReady({ route: '/friends', expectedRows: 2000 })).toBe(true)
  container.querySelector('[data-friend-row]')?.remove()
  // 画面の表示が「2,000件中」のままでも描画が不足したら完了にしない。
  expect(screenReady({ route: '/friends', expectedRows: 2000 })).toBe(false)
})
