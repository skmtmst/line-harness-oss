// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExternalImportWorkspace } from './external-import'

afterEach(cleanup)

// 決まり2: 変わらない物の説明は帯にせず、題の横の「？」へ入れる。
it('取り込んでも変わらない説明は帯に出さず題の「？」に入れる', async () => {
  render(<ExternalImportWorkspace external={{ currentDefault: null, lineMenus: [
    { richMenuId: 'rm-1', name: '外のメニュー', chatBarText: '開く', size: { width: 2500, height: 1686 }, areasCount: 2 },
  ] }} loading={false} error={null}
    onBack={() => {}} onReload={() => {}} onImport={() => {}} />)
  await screen.findByText(/取り込むと、できるようになること/)
  expect(screen.queryByText(/中身をこちらで持つようになるだけです/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '取り込んでも変わらない物の説明' }))
  expect(await screen.findByText(/中身をこちらで持つようになるだけです/)).toBeTruthy()
})
