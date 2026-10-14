// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SearchField from './search-field'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('即時の条件を使う画面は、入力直後の書き出しにも同じ値を渡す', () => {
  const exported = vi.fn()
  function Screen() {
    const [query, setQuery] = useState('')
    return <><SearchField aria-label="回答を探す" value={query} onChange={setQuery} updateMode="immediate" /><button onClick={() => exported(query)}>CSV</button></>
  }
  render(<Screen />)
  fireEvent.change(screen.getByLabelText('回答を探す'), { target: { value: '猫' } })
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
  expect(exported).toHaveBeenCalledWith('猫')
})

it('既定は確定した入力を300ms待ち、一回だけ渡す', () => {
  vi.useFakeTimers()
  const change = vi.fn()
  render(<SearchField aria-label="回答を探す" value="" onChange={change} />)
  fireEvent.change(screen.getByLabelText('回答を探す'), { target: { value: '猫' } })
  vi.advanceTimersByTime(299)
  expect(change).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(change).toHaveBeenCalledExactlyOnceWith('猫')
})

it('即時でも変換の途中は渡さず、確定とクリアを保つ', () => {
  const change = vi.fn(), clear = vi.fn()
  render(<SearchField aria-label="回答を探す" value="" onChange={change} onClear={clear} updateMode="immediate" />)
  const field = screen.getByLabelText('回答を探す')
  fireEvent.compositionStart(field)
  fireEvent.change(field, { target: { value: 'ねこ' } })
  expect(change).not.toHaveBeenCalled()
  fireEvent.compositionEnd(field, { data: '猫', target: { value: '猫' } })
  expect(change).toHaveBeenCalledExactlyOnceWith('猫')
  fireEvent.click(screen.getByRole('button', { name: '検索語を消す' }))
  expect(clear).toHaveBeenCalledOnce()
})
