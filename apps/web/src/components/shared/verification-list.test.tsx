// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import VerificationList from './verification-list'

afterEach(cleanup)

it('通過・停止・未検査を検査の題と説明に結び付ける', () => {
  render(<VerificationList items={[
    { key: 'channel', title: 'チャネル', detail: '認証済み', state: 'passed' },
    { key: 'webhook', title: 'Webhook', detail: 'LINE Developersで利用をオンにしてください', state: 'failed' },
    { key: 'url', title: '追加URL', detail: '接続してから確かめます', state: 'todo' },
  ]} />)
  const rows = within(screen.getByRole('list', { name: '接続確認項目' })).getAllByRole('listitem')
  expect(rows).toHaveLength(3)
  expect(within(rows[0]).getByText('通った')).toBeTruthy()
  expect(within(rows[1]).getByText('止まった')).toBeTruthy()
  expect(within(rows[1]).getByText('LINE Developersで利用をオンにしてください')).toBeTruthy()
  expect(within(rows[2]).getByText('まだ')).toBeTruthy()
})

it('長い検査説明は省略後にも全文を確認できる', () => {
  const detail = '入力した2つのチャネルが、同じプロバイダーに登録されていることを確認しました'
  render(<VerificationList items={[{ key: 'provider', title: 'プロバイダー', detail, state: 'passed' }]} />)
  expect(screen.getByText(detail).getAttribute('title')).toBe(detail)
})

it('検査項目が無いときは空の箱を増やさない', () => {
  const view = render(<VerificationList items={[]} />)
  expect(view.container.textContent).toBe('')
  expect(screen.queryByRole('list')).toBeNull()
})
