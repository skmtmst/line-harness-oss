// @vitest-environment happy-dom
/*
 * 監査 R251：自動応答の時刻候補をクリックしても選択が反映されない。
 *
 * 時刻ダイアログ（外側 MenuPortal）の中の時・分 Select の候補リストは、
 * 別の MenuPortal（内側）で body 直下に描かれる。候補への押下が外側の
 * 「外を押した」扱いで閉じる予約になり、click の後でダイアログごと消える。
 * 実ブラウザでは閉じる処理が先に流れて click が届かず、値が入らない。
 * キーボードでは入る。マウス・タップ・キーボードの3つで選べることを守る。
 *
 * 直しの向き（司令塔）：共通部品（MenuPortal）で直し、DateTimeField を使う
 * 全画面に効かせる。内側の候補への押下は外側扱いしない。
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimeField } from './date-time-field'

afterEach(() => cleanup())

function TimeHarness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <TimeField value={value} onChange={setValue} aria-label="時間帯の始まり" />
      <output data-testid="value">{value}</output>
    </>
  )
}

/** タップもマウスも pointerdown から始まる。押下を箱へ届ける。 */
function pointerDown(element: Element) {
  const Ctor =
    typeof PointerEvent === 'function'
      ? PointerEvent
      : (Event as unknown as new (type: string, init?: EventInit) => Event)
  element.dispatchEvent(new Ctor('pointerdown', { bubbles: true, cancelable: true }))
}

function openTimeDialog() {
  fireEvent.click(screen.getByRole('button', { name: '時間帯の始まり' }))
  expect(screen.getByRole('dialog', { name: '時刻を選ぶ' })).toBeTruthy()
}

/**
 * 候補を押す（マウス・タップの道）。選んだ後は値が入り、
 * 時刻ダイアログは開いたまま（分も続けて選べる）。
 */
function clickOption(name: string) {
  const option = screen.getByRole('button', { name })
  pointerDown(option)
  fireEvent.click(option)
}

describe('R251 時刻候補のクリックで値が入る', () => {
  it('空欄で時22時をクリックすると 22:00 になり、箱は開いたまま', () => {
    render(<TimeHarness />)
    openTimeDialog()
    fireEvent.click(screen.getByRole('button', { name: '時' }))
    clickOption('22時')
    expect(screen.getByTestId('value').textContent).toBe('22:00')
    // 直し前はここで箱が閉じている（外側扱いで閉じる予約が流れる）。
    expect(screen.getByRole('dialog', { name: '時刻を選ぶ' })).toBeTruthy()
  })

  it('空欄で分15分をクリックすると :15 が入り、箱は開いたまま', () => {
    render(<TimeHarness />)
    openTimeDialog()
    fireEvent.click(screen.getByRole('button', { name: '分' }))
    clickOption('15分')
    // 時は既定の10時（空欄の置き場所）で、分だけ替わる。
    expect(screen.getByTestId('value').textContent).toBe('10:15')
    expect(screen.getByRole('dialog', { name: '時刻を選ぶ' })).toBeTruthy()
  })

  it('既存値04:00で時2時をクリックすると 02:00 に替わる', () => {
    render(<TimeHarness initial="04:00" />)
    openTimeDialog()
    fireEvent.click(screen.getByRole('button', { name: '時' }))
    clickOption('2時')
    expect(screen.getByTestId('value').textContent).toBe('02:00')
    expect(screen.getByRole('dialog', { name: '時刻を選ぶ' })).toBeTruthy()
  })

  it('キーボード（↓・Enter）でも時を選べる', () => {
    render(<TimeHarness />)
    openTimeDialog()
    const trigger = screen.getByRole('button', { name: '時' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    // 既定10時から2つ下へ進めて12時で確定する。
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('12:00')
  })

  it('閉じる・開き直しで選んだ時刻が残る', () => {
    render(<TimeHarness />)
    openTimeDialog()
    fireEvent.click(screen.getByRole('button', { name: '時' }))
    clickOption('22時')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: '時間帯の始まり' }).textContent).toContain('22:00')
  })
})
