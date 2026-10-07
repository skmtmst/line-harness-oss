// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import ConfirmDialog from './confirm-dialog'

/*
 * 司令塔 2026-10-07：小窓だけの絵（MyJP7・F1LK4e・CVz5d など）は窓の頭が共通の値より
 * 約 33px 低い。絵の頭の余白・高さを画面から渡せる口（渡さなければ今までどおり）。
 */
afterEach(() => cleanup())
const css = readFileSync(join(process.cwd(), 'src/components/shared/dialog.module.css'), 'utf8')

describe('窓の頭の余白・高さを絵から渡す', () => {
  it('渡さなければ印も変数も付けない（今までどおり）', () => {
    render(<Dialog open modal={false} title="確認" onCancel={vi.fn()} />)
    const panel = screen.getByRole('dialog')
    expect(panel.hasAttribute('data-design-header-padding')).toBe(false)
    expect(panel.hasAttribute('data-design-header-height')).toBe(false)
    expect(panel.getAttribute('style')).toBeNull()
  })

  it('Dialog：渡すと印と変数が付く（幅と一緒でも両方残る）', () => {
    render(<Dialog open modal={false} title="確認" designWidth={520} designHeaderPadding="20px 20px 0" designHeaderHeight={44} onCancel={vi.fn()} />)
    const panel = screen.getByRole('dialog')
    expect(panel.hasAttribute('data-design-header-padding')).toBe(true)
    expect(panel.style.getPropertyValue('--dialog-design-header-padding')).toBe('20px 20px 0')
    expect(panel.style.getPropertyValue('--dialog-design-header-height')).toBe('44px')
    expect(panel.style.getPropertyValue('--dialog-design-width')).toBe('520px')
  })

  it('ConfirmDialog も同じ口を素通しする', () => {
    render(<ConfirmDialog open title="消しますか" description="戻せません" designHeaderPadding="24px 24px 0" onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const panel = document.body.querySelector('[data-design-part="dialog"]') as HTMLElement
    expect(panel.style.getPropertyValue('--dialog-design-header-padding')).toBe('24px 24px 0')
  })

  it('CSS：共通の頭の余白の後ろで、印のあるときだけ変数で上書きする', () => {
    const base = css.indexOf("[data-theme='v8'] .headerRow { width: 100%; padding: 20px 24px 8px;")
    const pad = css.indexOf("[data-theme='v8'] .panel[data-design-header-padding] > .headerRow { padding: var(--dialog-design-header-padding); }")
    const height = css.indexOf("[data-theme='v8'] .panel[data-design-header-height] > .headerRow { height: var(--dialog-design-header-height);")
    expect(base).toBeGreaterThan(-1)
    expect(pad).toBeGreaterThan(base)
    expect(height).toBeGreaterThan(base)
  })
})
