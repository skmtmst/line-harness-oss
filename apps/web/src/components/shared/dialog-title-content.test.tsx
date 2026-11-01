// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import ConfirmDialog from './confirm-dialog'
import TruncatedText from './truncated-text'

afterEach(cleanup)

it('表示を指定しない窓のSSRと名前入り削除の正規化を保つ', () => {
  const props = { open: true, title: '「営業時間」を消す', confirmLabel: '消す', tone: 'destructive' as const, onCancel: vi.fn(), onConfirm: vi.fn() }
  const html = renderToStaticMarkup(<Dialog {...props} />)
  expect(renderToStaticMarkup(<Dialog {...props} titleContent={undefined} />)).toBe(html)
  expect(html).toContain('「営業時間」を削除しますか？')
  expect(html).not.toContain('data-truncated-text')
  expect(html).not.toContain('data-title-content')
  const ordinary = renderToStaticMarkup(<Dialog open title="設定" onCancel={vi.fn()} onConfirm={vi.fn()} />)
  expect(ordinary).toContain('>設定</span>')
})

it('表示だけを省略部品へ渡しても見出しの読み上げと実行の口を保つ', () => {
  const title = '「' + '長い対象名'.repeat(20) + '」を削除しますか？'
  const confirm = vi.fn()
  render(<Dialog open title={title} titleContent={<TruncatedText value={title} />} tone="destructive" onCancel={vi.fn()} onConfirm={confirm} confirmLabel="削除する" />)
  const dialog = screen.getByRole('alertdialog', { name: title })
  const heading = screen.getByRole('heading', { name: title })
  expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id)
  expect(dialog.getAttribute('data-title-content')).toBe('true')
  expect(heading.querySelector('[data-truncated-text]')?.getAttribute('title')).toBe(title)
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '削除する', exact: true }))
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('既存のConfirmDialogも対象名と確定前の状態を保つ', () => {
  const confirm = vi.fn()
  render(<ConfirmDialog open title="消す確認" deleteName="連絡先" description="対象を確認してください" destructive onCancel={vi.fn()} onConfirm={confirm} />)
  expect(screen.getByRole('heading', { name: '「連絡先」を削除しますか？' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '削除する', exact: true })).toBeTruthy()
  expect(document.querySelector('[data-truncated-text]')).toBeNull()
  expect(document.querySelector('[data-title-content]')).toBeNull()
  expect(confirm).not.toHaveBeenCalled()
})
