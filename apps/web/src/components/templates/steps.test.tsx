// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Steps } from './steps'
import type { StepperStep } from '@/components/shared/stepper'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'steps.module.css'), 'utf8')
const templateCss = readFileSync(join(HERE, 'page-templates.module.css'), 'utf8')
const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const back = vi.fn()
const STEPS: StepperStep[] = [
  { key: 'basic', label: '基本設定', state: 'done', onSelect: back },
  { key: 'audience', label: '配信対象', state: 'done', onSelect: vi.fn() },
  { key: 'message', label: 'メッセージを作成', state: 'todo', onSelect: vi.fn() },
  { key: 'schedule', label: '送信設定', state: 'todo' },
]

/**
 * ★V8 の手順（共通部品 Fa8ED・決まりの板 q1xNMz。2026-10-08 オーナー）。
 * 丸22（済み＝緑に白い✓・今＝墨に白い数字・まだ＝薄い枠に灰の数字）・名13（今だけ太字）・線24×1.5。
 */
describe('手順（型の共通部品 Steps）', () => {
  it('段ごとに済み・今・まだの印を付け、今の段だけ aria-current="step"', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const nav = screen.getByRole('navigation', { name: '配信作成の進み' })
    const items = [...nav.querySelectorAll('li')]
    expect(items.map((li) => li.getAttribute('data-step-state'))).toEqual(['done', 'current', 'todo', 'todo'])
    expect(items.map((li) => li.querySelector('[data-step-dot]')?.getAttribute('data-step-dot'))).toEqual(['done', 'current', 'todo', 'todo'])
    /* 済みは ✓（番号を出さない）、今とまだは番号。 */
    expect(items[0].querySelector('[data-step-dot] svg')).toBeTruthy()
    expect(items[1].querySelector('[data-step-dot]')?.textContent).toBe('2')
    expect(items[2].querySelector('[data-step-dot]')?.textContent).toBe('3')
    const current = nav.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('配信対象')
    /* 段の間の線：済みの段の後ろは緑。 */
    expect([...nav.querySelectorAll('[data-step-line]')].map((line) => line.getAttribute('data-step-line'))).toEqual(['done', 'todo', 'todo'])
  })

  it('済みの段は押して戻れる（読み上げ「〇〇に戻る」）。今とまだの段は押せない', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['基本設定に戻る'])
    fireEvent.click(screen.getByRole('button', { name: '基本設定に戻る' }))
    expect(back).toHaveBeenCalledTimes(1)
    /* まだの段に行き先があっても押せない。今の段も押せない。 */
    expect(screen.queryByRole('button', { name: 'メッセージを作成に戻る' })).toBeNull()
    expect(screen.queryByRole('button', { name: '配信対象に戻る' })).toBeNull()
  })

  it('済みの段はボタンなので、キーボード（Enter・Space）でも押せる', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const button = screen.getByRole('button', { name: '基本設定に戻る' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('currentKey を渡さないときは、state が current の最初の段だけを今にする（印が2つ付かない）', () => {
    render(<Steps label="シナリオ作成の進み方" steps={[
      { label: 'シナリオ情報', state: 'current' },
      { label: '配信方式', state: 'current' },
      { label: '1通目を設定', state: 'todo' },
    ]} />)
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('シナリオ情報')
  })

  it('入らない幅では、今の段だけ名を出す（1行を守る・折り返さない）', () => {
    let resize: () => void = () => {}
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb } observe() {} disconnect() {} })
    const width = { nav: 300 }
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-part') === 'steps' ? width.nav : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'OL' ? 600 : 0
    })
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const nav = screen.getByRole('navigation', { name: '配信作成の進み' })
    expect(nav.hasAttribute('data-compact')).toBe(true)
    width.nav = 800
    act(() => resize())
    expect(nav.hasAttribute('data-compact')).toBe(false)
    vi.restoreAllMocks()
  })

  it('見た目：丸22・数11・名13・線24×1.5・間8・丸と名6。折り返さず、狭いときは今の段以外の名を隠す', () => {
    expect(globals).toMatch(/--tpl-steps-dot:\s*22px/)
    expect(globals).toMatch(/--tpl-steps-text-size:\s*13px/)
    expect(globals).toMatch(/--tpl-steps-num-size:\s*11px/)
    expect(globals).toMatch(/--tpl-steps-line-w:\s*24px/)
    expect(globals).toMatch(/--tpl-steps-line-h:\s*1\.5px/)
    expect(globals).toMatch(/--tpl-steps-gap:\s*8px/)
    expect(globals).toMatch(/--tpl-steps-dot-gap:\s*6px/)
    expect(css).toMatch(/\.list \{[^}]*flex-wrap:\s*nowrap/s)
    expect(css).toMatch(/\.dot\[data-step-dot='done'\] \{[^}]*background:\s*var\(--color-accent-deep\)/s)
    expect(css).toMatch(/\.dot\[data-step-dot='current'\] \{[^}]*background:\s*var\(--color-ink\)/s)
    expect(css).toMatch(/\.dot\[data-step-dot='todo'\] \{[^}]*var\(--color-control-border\)/s)
    expect(css).toMatch(/\.name\[data-step-name='current'\] \{[^}]*font-weight:\s*600/s)
    expect(css).toMatch(/\.name\[data-step-name='todo'\] \{[^}]*color:\s*var\(--color-ink-secondary\)/s)
    expect(css).toMatch(/\.line\[data-step-line='done'\] \{[^}]*var\(--color-accent-deep\)/s)
    expect(css).toMatch(/\.root\[data-compact\] \.name:not\(\[data-step-name='current'\]\)/)
    expect(css).toMatch(/button\.step:hover \.name \{[^}]*text-decoration:\s*underline/s)
  })

  it('置き場所：作る型では題 → 説明 → 手順（題の行の右は操作だけ）', () => {
    expect(templateCss).toMatch(/\[data-page-template='create'\] \.heading > \.headingText > \.titleRow \{[^}]*order:\s*1/s)
    expect(templateCss).toMatch(/\[data-page-template='create'\] \.heading > \.actions \{[^}]*order:\s*1/s)
    expect(templateCss).toMatch(/\[data-page-template='create'\] \.heading > \.headingText > \.description \{[^}]*order:\s*3/s)
    expect(templateCss).toMatch(/\[data-page-template='create'\] \.heading > \.steps \{[^}]*flex-basis:\s*100%[^}]*order:\s*5/s)
    expect(templateCss).not.toMatch(/data-steps-placement/)
  })
})
