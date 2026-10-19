// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { BookingRequest } from '@/lib/api'
import PeopleDayList from './day-list'
import type { usePeopleVisitMarks } from './use-visit-marks'

/*
 * 予約台帳（日の一覧行）の内側の余白。
 * ここは `--tpl-bkd-row-pad`（中身は `12px 16px`）を変数1語で渡していて、Card が
 * 左右別々の余白だと見抜けず（card.tsx の hasSides）、共通の下限 16 と突き合わされて
 * `max(16px, 12px 16px)` になり、CSS として成り立たないので余白が 0 に落ちていた。
 * ②Step2 の Webhook URL の枠と同じ罠。値を空白で分けて渡して直した。
 * 描いた結果に `data-card-spacing-sides` が付いているかだけを見る。
 */

const ROW = {
  id: 'r1',
  status: 'confirmed',
  source: 'liff',
  friend_name: '花子',
  menu_name: 'カット',
  staff_name: '担当A',
  starts_at: '2026-10-15T02:00:00Z',
  ends_at: '2026-10-15T03:00:00Z',
  price_at_booking: 5000,
} as BookingRequest

const VISITS = {
  status: 'ready',
  mark: () => null,
  busy: () => false,
  markVisit: async () => {},
  reload: () => {},
} as unknown as ReturnType<typeof usePeopleVisitMarks>

afterEach(cleanup)

describe('予約台帳の日の一覧行は内側の余白を保つ', () => {
  it('行の余白が左右別々として渡せている（潰れて 0 に落ちない）', () => {
    const { container } = render(<PeopleDayList rows={[ROW]} canMark={false} visits={VISITS} onOpen={() => {}} />)
    const row = container.querySelector<HTMLElement>('li [data-design-part="card"]')
    expect(row, '日の一覧行が描かれていない').not.toBeNull()
    expect((row as HTMLElement).hasAttribute('data-card-spacing-sides')).toBe(true)
    const style = (row as HTMLElement).getAttribute('style') ?? ''
    const padding = /--card-content-padding:\s*([^;]+)/.exec(style)?.[1]?.trim()
    expect(padding).toBe('var(--space-12) var(--space-16)')
  })
})
