// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mount } from './owner-content-fixture'
it('WEB-147：共通ヘッダーを編集する入口を置かない', () => {
  mount()
  expect(screen.queryByRole('button', { name: /共通ヘッダー/ })).toBeNull()
})
