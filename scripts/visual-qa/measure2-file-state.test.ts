import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error 撮影補助は素のJS。
import { applyFileState } from './measure2-file-state.mjs'

describe('CSVの撮影状態', () => {
  it('見本だけをメモリから選び、確認/反映のボタンを押さない', async () => {
    const setInputFiles = vi.fn(), waitFor = vi.fn()
    const page = { url: () => 'http://127.0.0.1:3459/friends/migrations', locator: vi.fn(() => ({ first: () => ({ setInputFiles }) })), getByText: vi.fn(() => ({ first: () => ({ waitFor }) })), waitForTimeout: vi.fn() }
    const sample = { name: 'friends.csv', text: 'LINEユーザーID,LINE表示名\nU11111111111111111111111111111111,撮影の見本\n' }
    await applyFileState(page, sample)
    const payload = setInputFiles.mock.calls[0][0]
    expect(payload.buffer.toString('utf8')).toBe(sample.text)
    expect(payload.mimeType).toBe('text/csv')
    expect(waitFor).toHaveBeenCalledWith({ state: 'visible' })
  })

  it.each([
    { name: '../private.csv', text: 'data' }, { name: 'friends.csv', text: '' },
    { name: 'friends.csv', text: 'あ'.repeat(65536) },
  ])('不正な見本はファイル選択の前に止まる: $name', async sample => {
    const locator = vi.fn()
    await expect(applyFileState({ url: () => 'http://localhost:3459', locator }, sample)).rejects.toThrow()
    expect(locator).not.toHaveBeenCalled()
  })

  it('見本サーバー以外では選択しない', async () => {
    const locator = vi.fn()
    await expect(applyFileState({ url: () => 'https://example.com', locator }, { name: 'friends.csv', text: 'data' })).rejects.toThrow('手元')
    expect(locator).not.toHaveBeenCalled()
  })
})
