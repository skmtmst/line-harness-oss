// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Tr, Td } from './table'
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })
test('一覧へ戻ったときは作った行だけを強調する', () => {
  window.history.replaceState(null, '', '/list?highlight=new')
  render(<table><tbody><Tr data-row-id="old"><Td>既存</Td></Tr><Tr data-row-id="new"><Td>新規</Td></Tr></tbody></table>)
  expect(screen.getByText('新規').closest('tr')?.getAttribute('data-created-highlight')).toBe('true')
  expect(screen.getByText('既存').closest('tr')?.getAttribute('data-created-highlight')).toBeNull()
})
