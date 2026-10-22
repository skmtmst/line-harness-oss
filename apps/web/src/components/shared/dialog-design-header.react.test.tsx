
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import ConfirmDialog from './confirm-dialog'
// @vitest-environment happy-dom

/*
 * 司令塔 2026-10-07：小窓だけの絵（・・ など）は窓の頭が共通の値より
 * 約 33px 低い。絵の頭の余白・高さを画面から渡せる口（渡さなければ今までどおり）。
 */
afterEach(() => cleanup())
const css = readFileSync(join(process.cwd(), 'src/components/shared/dialog.module.css'), 'utf8')

describe('窓の頭の余白・高さを絵から渡す', () => {
  it('任意の印を題と説明の左に置き、説明を読み上げに結び付ける', () => {
    render(<Dialog open modal={false} title="新しく作る" headerIcon={<svg data-testid="app-icon" />} description="名前を入力してください。" onCancel={vi.fn()} />)
    const panel = screen.getByRole('dialog', { name: '新しく作る' })
    const icon = screen.getByTestId('app-icon').parentElement!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.nextElementSibling?.contains(screen.getByRole('heading'))).toBe(true)
    expect(document.getElementById(panel.getAttribute('aria-describedby')!)?.textContent).toBe('名前を入力してください。')
  })

  it('確認の窓も任意の印を受け、取消と実行を保つ', () => {
    const cancel = vi.fn(), confirm = vi.fn()
    render(<ConfirmDialog open title="作成しますか？" description="内容を確認してください。" headerIcon={<svg data-testid="confirm-icon" />} onCancel={cancel} onConfirm={confirm} />)
    expect(screen.getByTestId('confirm-icon').parentElement?.getAttribute('aria-hidden')).toBe('true')
    screen.getByRole('button', { name: 'キャンセル' }).click()
    expect(cancel).toHaveBeenCalledTimes(1)
    screen.getByRole('button', { name: '実行する' }).click()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('渡さなければ印も変数も付けない（今までどおり）', () => {
    render(<Dialog open modal={false} title="確認" onCancel={vi.fn()} />)
    const panel = screen.getByRole('dialog')
    expect(panel.hasAttribute('data-design-header-padding')).toBe(false)
    expect(panel.hasAttribute('data-design-header-height')).toBe(false)
    expect(panel.style.getPropertyValue('--dialog-design-width')).toBe('560px')
  })

  it('Dialog：渡すと印と変数が付く（幅と一緒でも両方残る）', () => {
    render(<Dialog open modal={false} title="確認" designWidth={560} designHeaderPadding="20px 20px 0" designHeaderHeight={44} onCancel={vi.fn()} />)
    const panel = screen.getByRole('dialog')
    expect(panel.hasAttribute('data-design-header-padding')).toBe(true)
    expect(panel.style.getPropertyValue('--dialog-design-header-padding')).toBe('20px 20px 0')
    expect(panel.style.getPropertyValue('--dialog-design-header-height')).toBe('44px')
    expect(panel.style.getPropertyValue('--dialog-design-width')).toBe('560px')
  })

  it('ConfirmDialog も同じ口を素通しする', () => {
    render(<ConfirmDialog open title="消しますか" description="戻せません" designHeaderPadding="24px 24px 0" onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const panel = document.body.querySelector('[data-design-part="dialog"]') as HTMLElement
    expect(panel.style.getPropertyValue('--dialog-design-header-padding')).toBe('24px 24px 0')
  })

  it('CSS：共通の頭の余白の後ろで、印のあるときだけ変数で上書きする', () => {
    const base = css.indexOf(":root .headerRow { width: 100%; padding: 20px 24px 8px;")
    const pad = css.indexOf(":root .panel[data-design-header-padding] > .headerRow { padding: var(--dialog-design-header-padding); }")
    const height = css.indexOf(":root .panel[data-design-header-height] > .headerRow { height: var(--dialog-design-header-height);")
    expect(base).toBeGreaterThan(-1)
    expect(pad).toBeGreaterThan(base)
    expect(height).toBeGreaterThan(base)
  })
})
