// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button from '@/components/shared/button'
import { CreatePage } from './create-page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)

it('作成帯にキャンセル、下書き、公開を並べて操作できる', () => {
  const save = vi.fn()
  const { container } = render(<CreatePage title="イベントを作る" dirty={false} footerActions={<><Button>キャンセル</Button><Button onClick={save}>下書きを保存</Button><Button variant="primary">公開する</Button></>}>本文</CreatePage>)
  const footer = container.querySelector('[data-sticky-actions]') as HTMLElement
  expect(within(footer).getAllByRole('button').map(button => button.textContent)).toEqual(['キャンセル', '下書きを保存', '公開する'])
  fireEvent.click(within(footer).getByRole('button', { name: '下書きを保存' }))
  expect(save).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '作成・編集のその他の操作' })).toBeNull()
})
