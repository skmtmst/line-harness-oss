// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Select from '@/components/shared/select'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { OpsListToolbar } from './list-page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('各絞り込みへ共通の道具の間隔を渡す', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onChange = vi.fn()
  const errors = vi.spyOn(console, 'error')
  try {
    await act(async () => root.render(<OpsListToolbar
      search={{ value: '', onChange, placeholder: '探す' }}
      filters={<>
        <SaveErrorField names={['kind']}><Select aria-label="種類" value="" options={[{ value: '', label: 'すべて' }]} onChange={vi.fn()} /></SaveErrorField>
        <><SaveErrorField names={['state']}><Select aria-label="状態" value="" options={[{ value: '', label: 'すべて' }]} onChange={vi.fn()} /></SaveErrorField></>
      </>}
      trailing={<span>5件</span>}
    />))
    const slots = [...host.querySelectorAll('[data-toolbar-role="filter"]')]
      .filter(slot => slot.querySelector('button[aria-haspopup="listbox"]'))
    expect(slots).toHaveLength(2)
    expect(slots.every(slot => slot.querySelectorAll('button[aria-haspopup="listbox"]').length === 1)).toBe(true)
    expect(host.querySelector('[data-toolbar-end]')?.textContent).toBe('5件')
    const input = host.querySelector('input')!
    await act(async () => {
      fireEvent.change(input, { target: { value: '検索語' } })
    })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('検索語'))
    expect(errors).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    errors.mockRestore()
  }
})
