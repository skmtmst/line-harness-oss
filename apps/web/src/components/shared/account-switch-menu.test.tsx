// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountSwitchMenu from './account-switch-menu'

afterEach(cleanup)

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'account-switch-menu.module.css'), 'utf8')

describe('アカウントの切り替えの一覧（2026-10-25）', () => {
  it('各行は名前と @ID の2行で、長い名前は全文を title で見られる。選ぶと閉じて切り替える', () => {
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

  it('行の背景は1枚の面が動き、動きは CSS の transition だけで、動きを減らす設定では付けない', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.glow \{ transition: transform var\(--motion-switch-glide\)/)
    expect(css).not.toMatch(/\.glow[^{]*\{[^}]*animation/)
  })
})
