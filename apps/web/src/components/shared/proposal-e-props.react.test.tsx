// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
import { Tabs } from './tabs'
import { DashboardPage, DashboardRow } from '../templates/dashboard-page'

/*
 * 提案 E（今日のお店 hKRRF・電話予約 svUTk・ウォークイン PUWyq）で足した共通部品・型の口。
 * どれも「渡さなければ今までどおり」。渡した画面だけが絵の寸法になる。
 */
afterEach(() => cleanup())
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const tabsCss = read('src/components/shared/tabs.module.css')
const drawerCss = read('src/components/shared/drawer.module.css')
const dialogCss = read('src/components/shared/dialog.module.css')
const templateCss = read('src/components/templates/page-templates.module.css')
const globals = read('src/app/globals.css')

describe('タブの詰めた段（size="compact"）', () => {
  it('渡さなければ印を付けない。渡すと data-size="compact"', () => {
    const { rerender } = render(<Tabs label="t" items={[{ label: 'A', current: true }, { label: 'B' }]} />)
    expect(screen.getByRole('navigation').getAttribute('data-size')).toBeNull()
    rerender(<Tabs label="t" size="compact" items={[{ label: 'A', current: true }, { label: 'B' }]} />)
    expect(screen.getByRole('navigation').getAttribute('data-size')).toBe('compact')
  })

  it('詰めた段は v8 の文字の行だけを変数で詰め、選んだ下線を段の線に重ねる（既定の .tab は高さ auto のまま）', () => {
    expect(tabsCss).toMatch(/\[data-theme='v8'\] \.list\[data-size='compact'\] \.tab \{[^}]*line-height: var\(--tpl-tabs-compact-lh\)/)
    expect(tabsCss).toMatch(/\[data-theme='v8'\] \.list\[data-size='compact'\] \.current \{[^}]*margin-bottom: var\(--tpl-tabs-compact-line-overlap\)/)
    expect(globals).toMatch(/--tpl-tabs-compact-lh: 18\.5px/)
  })
})

describe('引き出しの幅（width="narrow"）', () => {
  it('渡さなければ印を付けない。渡すと data-width="narrow"', () => {
    const { rerender } = render(<Drawer open modal={false} title="引き出し" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('data-width')).toBeNull()
    rerender(<Drawer open modal={false} width="narrow" title="引き出し" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('data-width')).toBe('narrow')
  })

  it('狭い幅は v8 だけ 480（既定の 660 は変えない）', () => {
    expect(drawerCss).toMatch(/\[data-theme='v8'\] \.panel\[data-width='narrow'\] \{[^}]*width: min\(var\(--tpl-drawer-narrow-w\), 100%\)/)
    expect(drawerCss).toMatch(/\.panel \{[^}]*width: min\(660px, 100%\)/)
    expect(globals).toMatch(/--tpl-drawer-narrow-w: 480px/)
  })
})

describe('窓の下のボタンを中央に（footerAlign="center"）', () => {
  it('渡さなければ印を付けない。渡すと data-footer-align="center"', () => {
    const { rerender } = render(<Dialog open modal={false} title="窓" onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('data-footer-align')).toBeNull()
    rerender(<Dialog open modal={false} footerAlign="center" title="窓" onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('data-footer-align')).toBe('center')
  })

  it('中央寄せは v8 の印つきの窓だけ', () => {
    expect(dialogCss).toMatch(/\[data-theme='v8'\] \.panel\[data-footer-align='center'\] \.actions \{ justify-content: center; \}/)
  })
})

describe('ダッシュボードの型：タブの段と右の列の幅', () => {
  it('tabs を渡すと板の頭の直後にタブの段を置く。渡さなければ段を作らない', () => {
    const { container, rerender } = render(<DashboardPage title="題"><p>中身</p></DashboardPage>)
    expect(container.querySelector('[data-template-region="tabs"]')).toBeNull()
    rerender(<DashboardPage title="題" tabs={<span>タブ</span>}><p>中身</p></DashboardPage>)
    const tabs = container.querySelector('[data-template-region="tabs"]')
    expect(tabs?.textContent).toBe('タブ')
    expect(tabs?.previousElementSibling?.getAttribute('data-template-region')).toBe('heading')
  })

  it('asideSize="wide" で右の列が 360。渡さなければ既定（297）のまま', () => {
    const { container, rerender } = render(<DashboardRow aside={<p>右</p>}><p>左</p></DashboardRow>)
    expect(container.querySelector('aside')?.getAttribute('data-aside-size')).toBeNull()
    rerender(<DashboardRow asideSize="wide" aside={<p>右</p>}><p>左</p></DashboardRow>)
    expect(container.querySelector('aside')?.getAttribute('data-aside-size')).toBe('wide')
    expect(templateCss).toMatch(/\.dashboardAside\[data-aside-size='wide'\] \{ width: var\(--tpl-dash-aside-wide\); \}/)
    expect(templateCss).toMatch(/\.dashboardAside \{ width: 297px;/)
    expect(globals).toMatch(/--tpl-dash-aside-wide: 360px/)
  })
})
