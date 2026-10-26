// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountSwitchMenu from './account-switch-menu'

afterEach(cleanup)

describe('アカウントの切り替えの一覧', () => {
  it('各行に名前と @ID の2行を出し、長い名前も全文を title で見られる。選ぶと閉じて切り替える', () => {
    const onSelect = vi.fn(), onClose = vi.fn()
    const anchor = document.createElement('button'); document.body.append(anchor)
    render(<AccountSwitchMenu open onClose={onClose} getAnchor={() => anchor} selectedAccountId="a1" onSelect={onSelect}
      accounts={[{ id: 'a1', label: '然-NEN- 本店', basicId: 'nen-honten' }, { id: 'a2', label: 'とても長い名前のアカウント 渋谷店', basicId: '@nen-shibuya' }, { id: 'a3', label: 'ID なし' }]} />)
    const row = screen.getByRole('menuitemradio', { name: /渋谷店/ })
    expect(row.textContent).toContain('@nen-shibuya')
    expect(row.querySelector('[title="とても長い名前のアカウント 渋谷店"]')).not.toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /本店/ }).textContent).toContain('@nen-honten')
    expect(screen.getByRole('menuitemradio', { name: /ID なし/ }).textContent).not.toContain('@')
    fireEvent.click(row)
    expect(onClose).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('a2')
  })

  it('読み上げるのはアカウント名だけで、@ID は説明として読む', () => {
    const anchor = document.createElement('button'); document.body.append(anchor)
    render(<AccountSwitchMenu open onClose={() => {}} getAnchor={() => anchor} selectedAccountId="a1" onSelect={() => {}}
      accounts={[{ id: 'a1', label: '然-NEN- 本店', basicId: 'nen-honten' }, { id: 'a3', label: 'ID なし' }]} />)
    const menu = screen.getByRole('menu', { name: 'LINEアカウントの切り替え' })
    const row = screen.getByRole('menuitemradio', { name: '然-NEN- 本店' })
    expect(menu.contains(row)).toBe(true)
    expect(document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent).toBe('@nen-honten')
    expect(screen.getByRole('menuitemradio', { name: 'ID なし' }).hasAttribute('aria-describedby')).toBe(false)
  })
})
