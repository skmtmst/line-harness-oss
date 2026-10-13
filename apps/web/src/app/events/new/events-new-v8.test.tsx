// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ id: 'acc-1' as string | null }))
const createEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { ...actual.api.staff, me: vi.fn().mockResolvedValue({ success: true, data: { id: 'me', role: 'owner', isActive: true } }) } }, eventsApi: { ...actual.eventsApi, createEvent } }
})
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.id }) }))
import EventsNew from './page'

beforeEach(() => { account.id = 'acc-1'; createEvent.mockReset(); document.documentElement.dataset.theme = 'v8' })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

describe('V8-B イベントを作る（d4adD4）', () => {
  it('V8の型の中に現役の入力と保存する口がある', async () => {
    await act(async () => { render(<EventsNew />) })
    expect(document.querySelector('[data-design-node="d4adD4"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'イベントを作る' })).toBeTruthy()
    expect(screen.getByLabelText('イベント名')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下書きを保存' })).toBeTruthy()
  })

  it('アカウントが無いときは選ぶ案内になり、保存も送信もしない', async () => {
    account.id = null
    await act(async () => { render(<EventsNew />) })
    expect(screen.getByText('上のバーでLINE公式アカウントを選んでください')).toBeTruthy()
    const save = screen.getByRole('button', { name: '下書きを保存' }) as HTMLButtonElement
    const publish = screen.getByRole('button', { name: '公開する' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(publish.disabled).toBe(true)
    fireEvent.click(save)
    fireEvent.click(publish)
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('V8の型・色直書きなし・準備中なしを守る', () => {
    const css = readFileSync(join(process.cwd(), 'src/v8/events/create.module.css'), 'utf8')
    const source = readFileSync(join(process.cwd(), 'src/v8/events/create.tsx'), 'utf8')
    expect(source).toContain("import { CreatePage } from '@/components/templates'")
    expect(source).toContain('boardId="d4adD4"')
    expect(source).not.toContain('準備中')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(css.replace(/box-shadow:\s*var\(--card-shadow\)/g, '')).not.toMatch(/box-shadow\s*:/)
  })
})
