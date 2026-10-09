// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { listByKind: list, folders: { list: async () => [] }, get: async () => { throw new Error('no') } } }))
import HqTemplatePicker from './template-picker'

const rows = [{ id: 't-1', name: '店からの案内', kind: 'message', content_summary: 'お休みのお知らせ' }]
const props = { onClose: vi.fn(), onPick: vi.fn(async () => null) }
beforeEach(() => { document.documentElement.dataset.theme = 'v8'; list.mockReset(); list.mockResolvedValue(rows) })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme; vi.clearAllMocks() })

it('初回失敗→再試行で本当に読み直し、一覧から選べる', async () => {
  list.mockRejectedValueOnce(new Error('network'))
  render(<HqTemplatePicker open {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度試す' }))
  fireEvent.click(await screen.findByRole('radio', { name: '店からの案内' }))
  fireEvent.click(screen.getByRole('button', { name: 'このテンプレートを使う' }))
  expect(list).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(props.onPick).toHaveBeenCalledWith('t-1'))
  expect(props.onClose).toHaveBeenCalledTimes(1)
})

it('再試行も失敗したら再び理由と再試行を出す', async () => {
  list.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'))
  render(<HqTemplatePicker open {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度試す' }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('button', { name: 'もう一度試す' })).toBeTruthy()
  expect(screen.queryByText('統括のテンプレートがまだありません。「テンプレート」で作ってください。')).toBeNull()
})

it('閉じて開き直したあとの古い取得成功を捨てる', async () => {
  let finish!: (value: typeof rows) => void
  list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const view = render(<HqTemplatePicker open {...props} />)
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  view.rerender(<HqTemplatePicker open={false} {...props} />)
  view.rerender(<HqTemplatePicker open {...props} />)
  await screen.findByRole('radio', { name: '店からの案内' })
  await act(async () => { finish([{ ...rows[0], id: 'old', name: '古い取得' }]) })
  expect(screen.queryByRole('radio', { name: '古い取得' })).toBeNull()
})
