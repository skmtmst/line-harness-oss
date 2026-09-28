// @vitest-environment happy-dom
/**
 * m21u: 素の radio を共通部品（RadioCard・RadioCardGroup）へ置き換えた契約。
 *
 * 対象はシナリオのメッセージ種別欄（スタンプの決め方）。「一覧から選ぶ」
 * 「番号を直接入れる」の2つが群として読まれ、1つだけ選べることを見る。
 * 素の input に戻すと fieldset・legend がなくなり赤になる。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MessageKindFields, { emptyMessageKindState } from './message-kind-fields'

afterEach(() => cleanup())

function mount() {
  render(
    <MessageKindFields kind="sticker" value={emptyMessageKindState()} onChange={() => {}} />,
  )
}

describe('m21u: スタンプの決め方', () => {
  it('群として読まれる', () => {
    mount()
    expect(screen.getByRole('group', { name: 'スタンプの決め方' })).toBeTruthy()
  })

  it('2つの選択肢があり、はじめは「一覧から選ぶ」', () => {
    mount()
    const pick = screen.getByRole('radio', { name: '一覧から選ぶ' }) as HTMLInputElement
    const manual = screen.getByRole('radio', { name: '番号を直接入れる' }) as HTMLInputElement
    expect(pick.checked).toBe(true)
    expect(manual.checked).toBe(false)
    expect(pick.name).toBe('stickerMode')
    expect(manual.name).toBe(pick.name)
  })

  it('選び直すと1つだけ選ばれる', () => {
    mount()
    const pick = screen.getByRole('radio', { name: '一覧から選ぶ' }) as HTMLInputElement
    const manual = screen.getByRole('radio', { name: '番号を直接入れる' }) as HTMLInputElement
    fireEvent.click(manual)
    expect(manual.checked).toBe(true)
    expect(pick.checked).toBe(false)
  })
})
