// @vitest-environment happy-dom
/*
 * 入力の確かめ方（動きの点検・8）：誤りが出た欄は、打ち直し始めたらその場で赤と文を引っ込め、
 * 欄を離れたときに画面がまだ誤りを持っていれば、もう一度見せる。新しい誤りはすぐ見せる。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field, TextInput } from './form-controls'

afterEach(() => cleanup())

function Probe({ error }: { error?: string }) {
  return (
    <Field label="名前" htmlFor="name" error={error}>
      <TextInput id="name" invalid={Boolean(error)} defaultValue="" />
    </Field>
  )
}

describe('誤りの見せ方', () => {
  it('打ち直すと引っ込め、離れるとまだ誤りなら戻す。新しい誤りはすぐ出す', () => {
    const view = render(<Probe error="入力してください" />)
    expect(screen.getByRole('alert').textContent).toBe('入力してください')
    fireEvent.input(screen.getByLabelText('名前'), { target: { value: 'あ' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(screen.getByLabelText('名前'))
    expect(screen.getByRole('alert').textContent).toBe('入力してください')
    fireEvent.input(screen.getByLabelText('名前'), { target: { value: 'あい' } })
    expect(screen.queryByRole('alert')).toBeNull()
    view.rerender(<Probe error="20文字までです" />)
    expect(screen.getByRole('alert').textContent).toBe('20文字までです')
  })
})
