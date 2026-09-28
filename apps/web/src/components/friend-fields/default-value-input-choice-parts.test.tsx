// @vitest-environment happy-dom
/**
 * m21u: 素の checkbox を共通部品（Checkbox）へ置き換えた契約。
 *
 * 対象は友だち項目の既定値欄（複数選択）。選択肢ごとの箱が選択肢の名前で
 * 読まれ、文字を押しても切り替わり、追加・除外が呼び出し側へ伝わることを
 * 見る。素の input に戻すと群の名前・箱の名前の結びつきがなくなり赤になる。
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DefaultValueInput from './default-value-input'

afterEach(() => cleanup())

const noop = () => {}

function mountMulti(options: string[], multiValue: string[] = [], onMultiChange: (next: string[]) => void = noop) {
  render(
    <DefaultValueInput
      mode="multi"
      options={options}
      textValue=""
      onTextChange={noop}
      singleValue=""
      onSingleChange={noop}
      multiValue={multiValue}
      onMultiChange={onMultiChange}
    />,
  )
}

describe('m21u: 既定値（複数選択可）', () => {
  it('群として読まれる', () => {
    mountMulti(['赤', '青'])
    expect(screen.getByRole('group', { name: '既定値（複数選択可）' })).toBeTruthy()
  })

  it('箱の名前は選択肢の文字になる', () => {
    mountMulti(['赤', '青'])
    expect(screen.getByRole('checkbox', { name: '赤' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '青' })).toBeTruthy()
  })

  it('文字を押すと追加され、もう一度押すと外れる', () => {
    const seen: string[][] = []
    function Harness() {
      const [value, setValue] = useState<string[]>([])
      return (
        <DefaultValueInput
          mode="multi"
          options={['赤', '青']}
          textValue=""
          onTextChange={noop}
          singleValue=""
          onSingleChange={noop}
          multiValue={value}
          onMultiChange={(next) => {
            seen.push(next)
            setValue(next)
          }}
        />
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByText('赤'))
    expect(seen).toEqual([['赤']])
    expect((screen.getByRole('checkbox', { name: '赤' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByText('赤'))
    expect(seen).toEqual([['赤'], []])
  })

  it('選べないときは押しても伝わらない', () => {
    const onMultiChange = vi.fn()
    render(
      <DefaultValueInput
        mode="multi"
        options={['赤']}
        textValue=""
        onTextChange={noop}
        singleValue=""
        onSingleChange={noop}
        multiValue={[]}
        onMultiChange={onMultiChange}
        disabled
      />,
    )
    fireEvent.click(screen.getByText('赤'))
    expect(onMultiChange).not.toHaveBeenCalled()
  })
})
