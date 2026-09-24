// @vitest-environment happy-dom
/*
 * ★V7 顧客の一覧表（ノード `F38Tqj`）の共通部品の強化。
 * 既存の使い方を壊さないことが第一なので、互換の確認から始める。
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DataTable,
  SortTh,
  TableHeadRow,
  TableStateRow,
  Td,
  Th,
  Tr,
} from './table'

const DIR = dirname(fileURLToPath(import.meta.url))
const tableCss = readFileSync(join(DIR, 'table.module.css'), 'utf8')
const dataTableCss = readFileSync(join(DIR, 'data-table.module.css'), 'utf8')

afterEach(() => cleanup())

function renderTable(ui: React.ReactNode) {
  return render(
    <DataTable>
      <table>
        <tbody>{ui}</tbody>
      </table>
    </DataTable>,
  )
}

describe('既存の使い方を壊さない', () => {
  it('Th は今までどおり th・scope=col・左寄せ', () => {
    renderTable(
      <tr>
        <Th>友だち</Th>
      </tr>,
    )
    const th = screen.getByText('友だち')
    expect(th.tagName).toBe('TH')
    expect(th.getAttribute('scope')).toBe('col')
  })

  it('TableHeadRow は今までどおり見出し行を包む', () => {
    render(
      <DataTable>
        <table>
          <thead>
            <TableHeadRow>
              <Th>友だち</Th>
            </TableHeadRow>
          </thead>
        </table>
      </DataTable>,
    )
    expect(screen.getByText('友だち').closest('tr')).not.toBeNull()
  })

  it('一覧行の高さ58pxの既定は変えない', () => {
    expect(dataTableCss).toContain('height: 58px;')
  })

  it('Tr に何も渡さなければ aria-selected を付けない', () => {
    renderTable(
      <Tr>
        <Td>テスト 太郎</Td>
      </Tr>,
    )
    expect(screen.getByText('テスト 太郎').closest('tr')?.getAttribute('aria-selected')).toBeNull()
  })
})

describe('★V7の足し分', () => {
  it('ゆったりした行は64px・見出し行は40px（CSSの指定）', () => {
    expect(dataTableCss).toMatch(/\.rowComfortable\s*\{[^}]*height:\s*64px/s)
    expect(tableCss).toMatch(/\.headComfortable\s*\{[^}]*height:\s*40px/s)
  })

  it('選んだ行は aria-selected と薄い緑の地（色だけにしない）', () => {
    expect(dataTableCss).toMatch(/\.rowSelected\s*\{[^}]*var\(--color-accent-soft\)/s)
    renderTable(
      <Tr selected>
        <Td>Masato.S</Td>
      </Tr>,
    )
    expect(screen.getByText('Masato.S').closest('tr')?.getAttribute('aria-selected')).toBe('true')
  })

  it('指を乗せた行の地は押せる行だけ（CSSの指定）', () => {
    expect(dataTableCss).toMatch(/\.rowInteractive:hover\s*\{[^}]*var\(--color-canvas-sunken\)/s)
  })

  it('SortTh は並び順を読み上げと印の両方で伝える', () => {
    const { rerender } = render(
      <DataTable>
        <table>
          <thead>
            <TableHeadRow>
              <SortTh sort="asc" onSort={() => {}}>
                最終接触
              </SortTh>
            </TableHeadRow>
          </thead>
        </table>
      </DataTable>,
    )
    expect(screen.getByText('最終接触').closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(screen.getByRole('button', { name: '最終接触で並べ替える' })).not.toBeNull()
    expect(screen.getByText('▲')).not.toBeNull()

    rerender(
      <DataTable>
        <table>
          <thead>
            <TableHeadRow>
              <SortTh sort="none">最終接触</SortTh>
            </TableHeadRow>
          </thead>
        </table>
      </DataTable>,
    )
    expect(screen.getByText('最終接触').closest('th')?.getAttribute('aria-sort')).toBe('none')
    expect(screen.queryByText('▲')).toBeNull()
    expect(screen.queryByText('▼')).toBeNull()
  })

  it('SortTh を押すと並べ替えが始まる', () => {
    let calls = 0
    render(
      <DataTable>
        <table>
          <thead>
            <TableHeadRow>
              <SortTh sort="desc" onSort={() => { calls += 1 }}>
                最終接触
              </SortTh>
            </TableHeadRow>
          </thead>
        </table>
      </DataTable>,
    )
    fireEvent.click(screen.getByRole('button', { name: '最終接触で並べ替える' }))
    expect(calls).toBe(1)
    expect(screen.getByText('▼')).not.toBeNull()
  })

  it('空の行は「記録はありません」と次にすることだけ', () => {
    renderTable(<TableStateRow colSpan={2} kind="empty" />)
    expect(screen.getByText('記録はありません')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('読み込み中の行は待つ旨だけ', () => {
    renderTable(<TableStateRow colSpan={2} kind="loading" />)
    expect(screen.getByText('読み込んでいます')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('失敗の行はやり直すボタンを出す（渡したときだけ）', () => {
    let calls = 0
    const { rerender } = renderTable(<TableStateRow colSpan={2} kind="error" />)
    expect(screen.getByText('表示できませんでした')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()

    rerender(
      <DataTable>
        <table>
          <tbody>
            <TableStateRow colSpan={2} kind="error" onRetry={() => { calls += 1 }} />
          </tbody>
        </table>
      </DataTable>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(calls).toBe(1)
  })
})
