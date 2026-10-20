// @vitest-environment happy-dom
/*
 * ★管理画面 顧客の一覧表（ノード `F38Tqj`）の共通部品の強化。
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
  DateCell,
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
  it('日時セルは日付の内容・読み上げ・共通セルの配置を保つ', () => {
    renderTable(<Tr><DateCell align="right" title="2026年10月11日"><time dateTime="2026-10-11T12:34:00+09:00">10/11 12:34</time></DateCell></Tr>)
    const time = screen.getByText('10/11 12:34')
    expect(time.getAttribute('datetime')).toBe('2026-10-11T12:34:00+09:00')
    expect(time.closest('td')?.getAttribute('data-align')).toBe('right')
    expect(time.closest('td')?.getAttribute('title')).toBe('2026年10月11日')
    expect(tableCss).toMatch(/\.dateCell\s*\{[^}]*color:\s*var\(--color-ink-secondary\);[^}]*font-variant-numeric:\s*tabular-nums;[^}]*white-space:\s*nowrap;/s)
  })

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

  it('一覧行は現在のV8の共通の行高を使う', () => {
    expect(dataTableCss).toMatch(/:root \.frame \.row\s*\{[^}]*height: var\(--polish-table-row\)/s)
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

describe('一覧の行と選択', () => {
  it('行と見出しは現在のV8の共通の高さへそろえる', () => {
    expect(dataTableCss).toMatch(/:root \.frame \.row\s*\{[^}]*min-height:\s*var\(--polish-table-row\)/s)
    expect(tableCss).toMatch(/:root \.headRow \.cell\s*\{[^}]*height:\s*var\(--tpl-thead-h\)/s)
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
    expect(screen.getByLabelText('読み込んでいます').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('失敗の行は必ず読み直すボタンを出す', () => {
    let calls = 0
    const { rerender } = renderTable(<TableStateRow colSpan={2} kind="error" />)
    expect(screen.getByText('読み込めませんでした')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).not.toBeNull()

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


it('読むための履歴では操作の題を見せ、普通の表は読み上げだけを保つ', () => {
  const view = renderTable(<thead><TableHeadRow><Th>操作</Th></TableHeadRow></thead>)
  expect(screen.getByRole('columnheader', { name: '操作' }).querySelector('.sr-only')).toBeTruthy()
  view.rerender(<DataTable><thead><TableHeadRow><Th showActionLabel>操作</Th></TableHeadRow></thead></DataTable>)
  const heading = screen.getByRole('columnheader', { name: '操作' })
  expect(heading.querySelector('.sr-only')).toBeNull()
  expect(heading.getAttribute('scope')).toBe('col')
})
