// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Dialog, { DialogActions } from './dialog'
import Button from './button'

afterEach(cleanup)

it('脇の操作は左枠、取消と保存は中央の組に分け、同じ処理を呼ぶ', () => {
  const archive = vi.fn(), cancel = vi.fn(), save = vi.fn()
  const { container } = render(<Dialog open modal={false} title="設定" onCancel={cancel} footer={
    <DialogActions leadingAction={<Button onClick={archive}>アーカイブ</Button>}>
      <Button onClick={cancel}>キャンセル</Button><Button onClick={save}>保存</Button>
    </DialogActions>
  } />)
  const actions = container.querySelector('[data-dialog-actions]')!
  expect(actions.hasAttribute('data-dialog-action-pair')).toBe(true)
  const primaryPair = screen.getByRole('button', { name: '保存' }).parentElement!
  expect(primaryPair.contains(screen.getByRole('button', { name: 'キャンセル' }))).toBe(true)
  expect(primaryPair.contains(screen.getByRole('button', { name: 'アーカイブ' }))).toBe(false)
  for (const name of ['アーカイブ', 'キャンセル', '保存']) fireEvent.click(screen.getByRole('button', { name, exact: true }))
  expect(archive).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledOnce()
})

it('実行の確かめの窓は取消と赤い実行を同じ組に残す', () => {
  const { container } = render(<DialogActions><Button>キャンセル</Button><Button variant="danger">このまま削除</Button></DialogActions>)
  expect(screen.getByRole('button', { name: 'このまま削除' }).parentElement).toBe(container.querySelector('[data-dialog-actions]'))
  expect(container.querySelector('input')).toBeNull()
})

it('操作理由を共通の操作帯から読み上げ、保存の組と分ける', () => {
  render(<DialogActions note="キーワードを入力してください"><Button disabled>保存</Button></DialogActions>)
  expect(screen.getByRole('status').textContent).toBe('キーワードを入力してください')
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
})
