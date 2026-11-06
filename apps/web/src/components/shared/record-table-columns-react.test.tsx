// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DataTable, TableHeadRow, Td, Th, Tr } from './table'

afterEach(cleanup)

const rows = <><thead><TableHeadRow><Th>日時</Th><><Th>きっかけ</Th>{false && <Th>非表示</Th>}<Th grow>書き出したもの</Th></><Th>結果</Th></TableHeadRow></thead><tbody><Tr><Td>9/30 03:00</Td><Td>定期</Td><Td grow>友だち 1,284・フォーム回答 312</Td><Td>完了</Td></Tr></tbody></>
const tracks = () => screen.getByRole('table').parentElement!.style.getPropertyValue('--table-columns')

it('widthless records preserve all four header and body columns, including fragments', () => {
  render(<DataTable density="records">{rows}</DataTable>)
  expect(tracks()).toBe('repeat(4, minmax(0, 1fr))')
  expect(screen.getAllByRole('columnheader')).toHaveLength(4)
  expect(screen.getAllByRole('cell')).toHaveLength(4)
  expect(screen.getByText('友だち 1,284・フォーム回答 312')).toBeTruthy()
})

it('explicit record column allocation is preserved', () => {
  render(<DataTable density="records" columns="80px 60px minmax(0, 1fr) 100px">{rows}</DataTable>)
  expect(tracks()).toBe('80px 60px minmax(0, 1fr) 100px')
})

it('ordinary native tables receive no new grid allocation', () => {
  render(<DataTable>{rows}</DataTable>)
  expect(tracks()).toBe('')
})

it('an empty spanning state remains one state, rather than synthetic columns', () => {
  const { rerender } = render(<DataTable density="records"><tbody><Tr><Td colSpan={4}>記録はありません</Td></Tr></tbody></DataTable>)
  expect(screen.getAllByRole('cell')).toHaveLength(1)
  rerender(<DataTable density="records">{rows}</DataTable>)
  expect(tracks()).toBe('repeat(4, minmax(0, 1fr))')
  expect(screen.getAllByRole('cell')).toHaveLength(4)
})
