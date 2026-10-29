// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAdminVersionCache } from '@/lib/admin-version-cache'
import SidebarVersion from './sidebar-version'

const { update, access } = vi.hoisted(() => ({ update: { kind: 'fork' }, access: { role: 'owner' as string | null } }))
vi.mock('@/lib/staff-role', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/staff-role')>(),
  useStaffRole: () => access.role,
}))
vi.mock('@/components/update/use-update-status', () => ({
  useUpdateStatus: () => ({ ...update, reason: 'custom build', version: '2.7.0' }),
}))

const detail = {
  version: '2.7.0', worker_hash: '', admin_hash: '', liff_hash: '',
  git_commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  deploy_env: 'staging', released_at: '2026-09-27T04:05:00Z',
}
const fetchMock = vi.fn()
const json = (data: unknown) => ({ ok: true, json: async () => data }) as Response
async function mount(data: unknown = detail) {
  fetchMock.mockResolvedValue(json(data))
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<SidebarVersion />) })
  return view
}
function open() {
  const trigger = screen.getByRole('button', { name: '2.7.0・検証環境' })
  fireEvent.click(trigger)
  return { trigger, dialog: screen.getByRole('dialog', { name: '版の情報' }) }
}

beforeEach(() => {
  update.kind = 'fork'
  access.role = 'owner'
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  clearAdminVersionCache()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.NEXT_PUBLIC_API_URL
  clearAdminVersionCache()
})

describe('左メニューの版は1行、詳細と更新は開いて確かめる', () => {
  it.each(['fork', 'upgrade', 'latest', 'loading'])('%sの更新案内は閉じた版の行でも伝える', async kind => {
    update.kind = kind
    await mount()
    const trigger = screen.getByRole('button', { name: '2.7.0・検証環境' })
    const notice = kind === 'fork' || kind === 'upgrade'
    expect(trigger.querySelector('[data-version-update]') !== null).toBe(notice)
    expect(trigger.getAttribute('aria-description')).toBe(kind === 'upgrade' ? '更新あり' : kind === 'fork' ? 'カスタマイズ版の更新案内' : null)
    expect(trigger.querySelector('[data-version-update]')?.getAttribute('title') ?? null).toBe(kind === 'upgrade' ? '更新あり' : kind === 'fork' ? 'カスタマイズ版の更新案内' : null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('日時は閉じた状態で描画せず、実版と環境を出す', async () => {
    await mount()
    expect(screen.getByRole('button', { name: '2.7.0・検証環境' }).title).toBe('2.7.0・検証環境')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/配備/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example.com/admin/version')
    const { trigger, dialog } = open()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).not.toBeNull()
    expect(dialog.textContent).toContain('Ver. 2.7.0（a1b2c3d）')
    expect(dialog.textContent).toContain('9月27日 13:05 配備・検証環境')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '閉じる' }))
  })

  it.each(['Escape', 'outside', 'close', 'trigger'])('%sで閉じ、焦点を開いた操作へ戻す', async how => {
    await mount()
    const { trigger, dialog } = open()
    if (how === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    else if (how === 'outside') fireEvent.pointerDown(document.body)
    else if (how === 'close') fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    else fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it.each(['fork', 'upgrade', 'latest', 'loading'])('%sの更新導線を保ち、必要な時だけ社内ガイドを出す', async kind => {
    update.kind = kind
    await mount()
    const { dialog } = open()
    const manual = within(dialog).queryByRole('link', { name: '手動で更新' }) as HTMLAnchorElement | null
    if (kind === 'fork' || kind === 'upgrade') {
      expect(manual).not.toBeNull()
      expect(manual!.getAttribute('href')).toBe('/updates')
      expect(manual!.getAttribute('href')).toMatch(/^\/(?!\/)/)
      expect(manual!.target).not.toBe('_blank')
    } else expect(manual).toBeNull()
    const updates = dialog.querySelector('a[href="/updates"]')
    expect(updates?.textContent ?? null).toBe(kind === 'fork' ? '更新履歴' : kind === 'upgrade' ? '更新あり' : null)
  })

  it.each(['owner', 'admin', 'staff', 'viewer', null])('役割%sでは許可された人だけ手動ガイドを出す', async role => {
    access.role = role
    for (const kind of ['fork', 'upgrade']) {
      update.kind = kind
      const view = await mount()
      const { dialog } = open()
      const manual = within(dialog).queryByRole('link', { name: '手動で更新' })
      expect(manual !== null).toBe(role === 'owner' || role === 'admin')
      if (manual) expect(manual.getAttribute('href')).toBe('/updates')
      expect(within(dialog).getByRole('link', { name: kind === 'fork' ? '更新履歴' : '更新あり' })).toBeTruthy()
      view.unmount()
    }
  })

  it('開いた後に役割が変わっても手動ガイドを残さず、権限取得後だけ出す', async () => {
    const view = await mount()
    open()
    expect(screen.getByRole('link', { name: '手動で更新' })).toBeTruthy()
    for (const role of ['viewer', 'staff', null]) {
      access.role = role
      view.rerender(<SidebarVersion />)
      expect(screen.queryByRole('link', { name: '手動で更新' })).toBeNull()
    }
    access.role = 'admin'
    view.rerender(<SidebarVersion />)
    expect(screen.getByRole('link', { name: '手動で更新' }).getAttribute('href')).toBe('/updates')
  })

  it('取得中から成功まで同じ外枠と操作を維持し、先に開いた詳細も更新する', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const { container } = render(<SidebarVersion />)
    const frame = container.querySelector('[data-sidebar-version]')!
    const trigger = screen.getByRole('button', { name: '版の情報を取得中' })
    const classes = trigger.className
    expect(frame.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(trigger)
    await act(async () => { resolve(json(detail)) })
    expect(container.querySelector('[data-sidebar-version]')).toBe(frame)
    expect(screen.getByRole('button', { name: '2.7.0・検証環境' })).toBe(trigger)
    expect(trigger.className).toBe(classes)
    expect(frame.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('dialog').textContent).toContain('a1b2c3d')
  })

  it('取得失敗でも偽の値や赤い警告を出さず、詳細ガイドを利用できる', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    await act(async () => { render(<SidebarVersion />) })
    fireEvent.click(screen.getByRole('button', { name: '版の情報なし' }))
    expect(screen.getByRole('status').textContent).toBe('版の情報なし')
    expect(screen.getByRole('link', { name: '手動で更新' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('仮の版・未知commitを実在する値に見せない', async () => {
    await mount({ ...detail, version: '0.0.0-dev', git_commit: 'unknown', released_at: '1970-01-01T00:00:00Z' })
    fireEvent.click(screen.getByRole('button', { name: '版の情報なし' }))
    expect(screen.getByRole('dialog').textContent).not.toMatch(/0\.0\.0|1970|unknown/)
  })

  it.each([null, 'preview-east-with-a-long-environment-name'])('環境%sを捏造せず、長い実値をtitleにも残す', async env => {
    await mount({ ...detail, deploy_env: env, git_commit: 'unknown', released_at: '' })
    const label = `2.7.0${env ? `・${env}` : ''}`
    const trigger = screen.getByRole('button', { name: label })
    expect(trigger.title).toBe(label)
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog').textContent).not.toContain('unknown')
    if (!env) expect(screen.getByRole('dialog').textContent).toContain('配備日時・環境の情報なし')
  })

  it('アンマウント後の遅い応答は次の版表示へ混ぜない', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const view = render(<SidebarVersion />)
    view.unmount()
    clearAdminVersionCache()
    await mount({ ...detail, version: '2.8.0' })
    await act(async () => { resolve(json(detail)) })
    expect(screen.getByRole('button', { name: '2.8.0・検証環境' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '2.7.0・検証環境' })).toBeNull()
  })
})
