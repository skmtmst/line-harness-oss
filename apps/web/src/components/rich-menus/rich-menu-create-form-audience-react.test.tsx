// @vitest-environment happy-dom
/*
 * 作成フォームの「最初に見せるページと、出す相手」の欄の試験。
 * - 出す相手を決める画面だけに欄を出し、切替タブがあるときは最初に見せるページも選ばせる
 * - 条件で出し分けると全員の既定を外し、全員の既定は出し分けと同時に選ばせない
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RichMenuCreateForm from './rich-menu-create-form'
import { freshRichMenuCreateValue, type RichMenuCreateValue } from './rich-menu-create-model'

vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))

afterEach(cleanup)

function renderForm(value: RichMenuCreateValue, audienceSetup: boolean) {
  const onChange = vi.fn()
  const view = render(<RichMenuCreateForm value={value} onChange={onChange} audienceSetup={audienceSetup} />)
  return { view, onChange }
}

const latest = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0] as RichMenuCreateValue

describe('最初に見せるページと、出す相手', () => {
  it('出す相手を決めない画面には欄を出さない', () => {
    const { view } = renderForm({ ...freshRichMenuCreateValue(), tabCount: 1 }, false)
    expect(view.queryByText('最初に見せるページと、出す相手')).toBeNull()
    expect(view.queryByRole('radio', { name: /条件に当てはまる友だちだけ/ })).toBeNull()
  })

  it('切替タブがあるときは最初に見せるページを選ばせる', () => {
    const { view } = renderForm({ ...freshRichMenuCreateValue(), tabCount: 1 }, true)
    expect(view.getByText('最初に見せるページと、出す相手')).toBeTruthy()
    expect(view.getByLabelText('最初に見せるページ')).toBeTruthy()
  })

  it('条件で出し分けると全員の既定を外す', () => {
    const { view, onChange } = renderForm({ ...freshRichMenuCreateValue(), isDefaultForAll: true }, true)
    fireEvent.click(view.getByRole('radio', { name: /条件に当てはまる友だちだけ/ }))
    expect(latest(onChange)).toMatchObject({ targetingEnabled: true, isDefaultForAll: false })
  })

  it('全員に出すときは既定にでき、出し分けのときは既定を選ばせない', () => {
    const plain = renderForm({ ...freshRichMenuCreateValue(), targetingEnabled: false, isDefaultForAll: false }, true)
    const box = plain.view.getByRole('switch', { name: /既定メニューにする/ }) as HTMLButtonElement
    expect(box.disabled).toBe(false)
    fireEvent.click(box)
    expect(latest(plain.onChange)).toMatchObject({ isDefaultForAll: true })
    cleanup()
    const targeted = renderForm({ ...freshRichMenuCreateValue(), targetingEnabled: true, isDefaultForAll: false }, true)
    expect((targeted.view.getByRole('switch', { name: /既定メニューにする/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
