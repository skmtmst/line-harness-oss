// @vitest-environment happy-dom
/* 帯（Notice）。★管理画面 共通部品その2 §1 の4種類を1本で出す。 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Notice from './notice'

afterEach(() => cleanup())

describe('帯（Notice）の4種類', () => {
  it.each(['info', 'success', 'warn', 'danger'] as const)('%s は題の前に8pxの色点だけを出す', tone => {
    const { container } = render(<Notice tone={tone} heading="題" message="説明" />)
    const notice = container.firstElementChild!
    const dot = notice.querySelector('[data-notice-dot]')
    expect(dot?.tagName).toBe('SPAN')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
    expect(notice.firstElementChild).toBe(dot)
    expect(notice.querySelector('svg')).toBeNull()
    expect(notice.className).toContain(tone)
  })

  it('互換 prop に絵が渡されても色点だけを使う', () => {
    const { container } = render(<Notice tone="info" icon={<i data-testid="custom-icon" />} message="案内" />)
    expect(container.querySelector('[data-testid="custom-icon"]')).toBeNull()
    expect(container.querySelector('[data-notice-dot]')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('案内・うまくいった・注意・危険を同じ API で出す', () => {
    for (const tone of ['info', 'success', 'warn', 'danger'] as const) {
      const { container, unmount } = render(<Notice tone={tone} message={`${tone}の帯`} />)
      const root = container.firstElementChild!
      expect(root.getAttribute('data-design-part')).toBe('notice')
      expect(root.textContent).toContain(`${tone}の帯`)
      // 題の前の色点は読み上げない。
      expect(root.querySelector('[data-notice-dot][aria-hidden="true"]')).not.toBeNull()
      unmount()
    }
  })

  it('危険だけ role=alert、ほかは role=note', () => {
    const { container: danger } = render(<Notice tone="danger" message="止まっています" />)
    expect(danger.firstElementChild!.getAttribute('role')).toBe('alert')
    for (const tone of ['info', 'success', 'warn'] as const) {
      const { container, unmount } = render(<Notice tone={tone} message="お知らせ" />)
      expect(container.firstElementChild!.getAttribute('role')).toBe('note')
      unmount()
    }
  })

  it('呼び出し側が role を指定したら上書きしない（注意色でも alert・案内でも status）', () => {
    const { container: w } = render(<Notice tone="warn" role="alert" message="別の画面で変わりました" />)
    expect(w.firstElementChild!.getAttribute('role')).toBe('alert')
    const { container: i } = render(<Notice tone="info" role="status" message="読み込んでいます" />)
    expect(i.firstElementChild!.getAttribute('role')).toBe('status')
  })

  it('種類ごとの色と通知の役割を持つ', () => {
    for (const tone of ['info', 'success', 'warn', 'danger'] as const) {
      const { container, unmount } = render(<Notice tone={tone} message="お知らせ" />)
      expect(container.firstElementChild!.className).toContain(tone)
      expect(container.firstElementChild!.getAttribute('role')).toBe(tone === 'danger' ? 'alert' : 'note')
      // 崩れの見張りは data-tone で警告・失敗の文が切れていないかを見る。
      expect(container.firstElementChild!.getAttribute('data-tone')).toBe(tone)
      unmount()
    }
  })

  it('右に操作を1つ置ける', () => {
    const { container } = render(
      <Notice tone="warn" message="入力が要ります" action={<a href="/settings">設定を見る</a>} />,
    )
    expect(container.querySelector('a')!.textContent).toBe('設定を見る')
    expect(container.firstElementChild!.hasAttribute('data-action-layout')).toBe(false)
  })

  it.each([false, true])('狭幅で操作を下へ置く帯でも本文・操作・閉じる口・tone 固有の印を保つ（旧指定=%s）', withoutIcon => {
    const onClose = vi.fn()
    const { container } = render(
      <Notice tone="warn" actionLayout="stack-on-narrow" icon={withoutIcon ? null : undefined}
        message="いつもと違う端末からのログインです" action={<a href="/staff">端末を確認する</a>} onClose={onClose} />,
    )
    const notice = screen.getByRole('note')
    expect(notice.getAttribute('data-action-layout')).toBe('stack-on-narrow')
    expect(screen.getByText('いつもと違う端末からのログインです')).toBeTruthy()
    expect(screen.getByRole('link', { name: '端末を確認する' }).getAttribute('href')).toBe('/staff')
    expect(container.querySelector('[role="note"] > [data-notice-dot][aria-hidden="true"]')).not.toBeNull()
    expect(notice.children.length).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: '通知を閉じる' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('操作が無い帯は配置を指定しても空の操作行を設けない', () => {
    render(<Notice tone="info" actionLayout="stack-on-narrow" message="お知らせ" />)
    expect(screen.getByRole('note').hasAttribute('data-action-layout')).toBe(false)
  })

  it('閉じる印は押すと onClose を呼ぶ', () => {
    const onClose = vi.fn()
    const { container } = render(<Notice tone="success" message="保存しました" onClose={onClose} />)
    const button = container.querySelector('button[aria-label="通知を閉じる"]')!
    ;(button as HTMLButtonElement).click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('閉じる印は右の操作と同じ行に入る', () => {
    const { container } = render(<Notice tone="info" action={<button>確認</button>} onClose={() => undefined}>案内</Notice>)
    const close = screen.getByRole('button', { name: '通知を閉じる' })
    expect(close.parentElement?.className).toContain('action')
    expect(container.querySelector('[data-has-action]')).not.toBeNull()
  })

  it('互換 prop が残っていても題の前の色点だけを使う', () => {
    const custom = render(<Notice tone="info" message="順番の案内" icon={<i data-testid="custom-icon" />} />)
    expect(custom.container.querySelector('[data-testid="custom-icon"]')).toBeNull()
    expect(custom.container.querySelector('[data-notice-dot]')).not.toBeNull()
    custom.unmount()
    const none = render(<Notice tone="info" message="順番の案内" icon={null} />)
    expect(none.container.querySelector('[data-notice-dot]')).not.toBeNull()
    expect(none.container.firstElementChild!.textContent).toContain('順番の案内')
    none.unmount()
    const def = render(<Notice tone="info" message="順番の案内" />)
    expect(def.container.querySelector('[data-notice-dot]')).not.toBeNull()
    def.unmount()
  })

  it('補足の「？」は見出しの横に入り、本文は1〜2文のまま', () => {
    const { container } = render(
      <Notice tone="info" message="この画面の数は日本時間で数えます。" help="0時締めです" helpLabel="数の数え方" />,
    )
    expect(container.firstElementChild!.textContent).toContain('この画面の数は日本時間で数えます。')
    expect(container.querySelector('button[aria-label="数の数え方の説明"]')).not.toBeNull()
  })
})
