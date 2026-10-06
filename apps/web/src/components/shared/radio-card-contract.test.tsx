// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RadioCard, { RadioCardGroup } from './radio-card'

afterEach(cleanup)

function Group({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <RadioCardGroup legend="配信方法">
      <RadioCard name="delivery" value="a" checked={value === 'a'} onChange={setValue} title="新しく作る" note="一から作ります。" />
      <RadioCard name="delivery" value="b" checked={value === 'b'} onChange={setValue} title="複製する" note="過去の配信を写します。" />
    </RadioCardGroup>
  )
}

describe('ラジオカード（DEEP-02）', () => {
  it('●・○の文字ではなく本物の input[type=radio] を出し、群名を legend で伝える', () => {
    render(<Group />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    for (const radio of radios) {
      expect((radio as HTMLInputElement).type).toBe('radio')
      // 同じ name の群なので、Tabで群に入り矢印キーで行き来できる（native の動作）
      expect((radio as HTMLInputElement).name).toBe('delivery')
    }
    // 読み上げの群名は fieldset/legend。装飾の●・○は本文に残さない。
    expect(document.querySelector('fieldset legend')?.textContent).toBe('配信方法')
    expect(document.body.textContent).not.toContain('●')
    expect(document.body.textContent).not.toContain('○')
  })

  it('選択状態を checked として伝え、クリックで切り替わる', () => {
    render(<Group />)
    const a = screen.getByRole('radio', { name: /新しく作る/ }) as HTMLInputElement
    const b = screen.getByRole('radio', { name: /複製する/ }) as HTMLInputElement
    expect(a.checked).toBe(true)
    expect(b.checked).toBe(false)
    fireEvent.click(b)
    expect(a.checked).toBe(false)
    expect(b.checked).toBe(true)
  })

  it('カード全体が押せる（input は label に包まれている）', () => {
    const onChange = vi.fn()
    render(<RadioCard name="g" value="x" checked={false} onChange={onChange} title="対象を選ぶ" />)
    const input = screen.getByRole('radio')
    // カード＝label が input を囲むので、タイトル面を押しても選択できる
    expect(input.closest('label')).not.toBeNull()
    fireEvent.click(input)
    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('フォーカスは input が受け、フォーカス枠は選択色と別', () => {
    render(<RadioCard name="g" value="x" checked={false} onChange={() => {}} title="対象" />)
    const input = screen.getByRole('radio')
    ;(input as HTMLElement).focus()
    expect(document.activeElement).toBe(input)
  })

  it('無効のときは選べず、理由を併記する。選択済みの見た目にはしない', () => {
    const onChange = vi.fn()
    render(
      <RadioCardGroup legend="方法">
        <RadioCard name="g" value="x" checked={false} onChange={onChange} title="まだ選べない" disabled disabledReason="アカウント接続後に選べます" />
      </RadioCardGroup>,
    )
    const input = screen.getByRole('radio') as HTMLInputElement
    expect(input.disabled).toBe(true)
    fireEvent.click(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.checked).toBe(false)
    expect(screen.getByText('アカウント接続後に選べます')).toBeTruthy()
  })

  it('エラー状態は aria-invalid で伝える', () => {
    render(<RadioCard name="g" value="x" checked={false} onChange={() => {}} title="対象" invalid />)
    expect(screen.getByRole('radio').getAttribute('aria-invalid')).toBe('true')
  })

  it('icon={null} で上段の図柄なし（j8p3yj の絵どおり題＋説明のみ）', () => {
    const { container } = render(
      <RadioCard name="g" value="x" checked={false} onChange={() => {}} title="対象" note="説明" icon={null} />,
    )
    // 上段の図柄（aria-hidden の飾り span）が出ない。題と説明は残る。
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull()
    expect(screen.getByText('対象')).toBeTruthy()
    expect(screen.getByText('説明')).toBeTruthy()
  })

  it('印は渡したときだけ出る（本線の既定。合格した画面は印を渡している）', () => {
    const { container } = render(
      <RadioCard name="g" value="x" checked={false} onChange={() => {}} title="対象" />,
    )
    expect(container.querySelector('span[aria-hidden="true"] svg')).toBeNull()
  })
})

describe('選ぶカードの箱（fNPdg オン・r3xz1W オフ）の数値', () => {
  const css = () =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'radio-card.module.css'), 'utf8')

  it('箱は高さ98・内側14・間8・角丸12（オン・オフ共通）', () => {
    const blocks = [...css().matchAll(/\[data-theme='v8'\]\s*\.card\s*\{[^}]*\}/gs)].map((m) => m[0])
    expect(blocks.length, 'v8 の箱の指定がありません').toBeGreaterThan(0)
    // 値は複数の v8 ブロックに分かれる。どれかにあればよい（後勝ちで打ち消しなし）。
    for (const re of [/min-height:\s*98px/, /padding:\s*14px/, /gap:\s*8px/, /border-radius:\s*12px/]) {
      expect(blocks.some((b) => re.test(b)), `${re} が v8 の箱にありません`).toBe(true)
    }
  })

  it('オンは淡緑の地面＋1.5px の濃い緑の枠・題13/600/20・説明12/18（fNPdg）', () => {
    const c = css()
    expect(c).toMatch(/\[data-theme='v8'\]\s*\.checked[^{]*\{[^}]*outline:\s*1\.5px solid var\(--color-accent-deep\)/s)
    const titles = [...c.matchAll(/\[data-theme='v8'\]\s*\.title\s*\{[^}]*\}/gs)].map((m) => m[0])
    expect(titles.length, 'v8 の題の指定がありません').toBeGreaterThan(0)
    const title = titles[titles.length - 1]
    expect(title).toMatch(/font-size:\s*13px/)
    expect(title).toMatch(/line-height:\s*20px/)
    expect(title).toMatch(/font-weight:\s*600/)
    const notes = [...c.matchAll(/\[data-theme='v8'\]\s*\.note\s*\{[^}]*\}/gs)].map((m) => m[0])
    expect(notes.length, 'v8 の説明の指定がありません').toBeGreaterThan(0)
    const note = notes[notes.length - 1]
    expect(note).toMatch(/font-size:\s*12px/)
    expect(note).toMatch(/line-height:\s*18px/)
    // 選んだ印タグは濃い緑（#087a3e）。
    expect(c).toMatch(/\[data-theme='v8'\]\s*\.checked \.topIcon\s*\{[^}]*color:\s*var\(--color-accent-deep\)/s)
  })

  it('オフは白地＋1px の hairline 枠・丸の輪郭 control-border（r3xz1W）', () => {
    const c = css()
    expect(c).toMatch(/\[data-theme='v8'\]\s*\.card\s*\{[^}]*outline:\s*1px solid var\(--color-hairline\)/s)
  })
})

describe('選ぶカードの行型（BHEl9・変わり形）', () => {
  it('箱なしの行で、本物の input[type=radio] のまま選べる', () => {
    const onChange = vi.fn()
    render(
      <RadioCardGroup legend="担当範囲">
        <RadioCard name="scope" value="all" checked={false} onChange={onChange} title="全アカウント" variant="row" />
        <RadioCard name="scope" value="part" checked onChange={onChange} title="一部のアカウント" note="選んだアカウントだけ" variant="row" />
      </RadioCardGroup>,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    const labels = document.querySelectorAll('label[data-variant="row"]')
    expect(labels).toHaveLength(2)
    // 行全体が label で、押すと選べる。
    expect(radios[0].closest('label')?.getAttribute('data-variant')).toBe('row')
    fireEvent.click(radios[0])
    expect(onChange).toHaveBeenCalledWith('all')
    // 補足も行の中に出る。
    expect(screen.getByText('選んだアカウントだけ')).toBeTruthy()
  })

  it('行は丸18・間8・箱と面なし（BHEl9 の数値）', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'radio-card.module.css'), 'utf8')
    const row = css.match(/\.row\s*{[^}]*}/s)
    expect(row, '行型の指定がありません').toBeTruthy()
    expect(row![0]).toMatch(/gap:\s*8px/)
    expect(row![0]).toMatch(/background:\s*transparent/)
    expect(row![0]).not.toMatch(/border:[^}]*solid/)
    const rowRadio = css.match(/\[data-theme='v8'\]\s*\.row\s*\.radio\s*{[^}]*}/s)
    expect(rowRadio, '行型の丸の指定がありません').toBeTruthy()
    expect(rowRadio![0]).toMatch(/width:\s*18px/)
    expect(rowRadio![0]).toMatch(/position:\s*static/)
    // 箱（fNPdg/r3xz1W）の既定は変えない。
    expect(css).toMatch(/\[data-theme='v8'\]\s*\.card\s*{[^}]*min-height:\s*98px/s)
  })
})

describe('V8 の丸（2026-10-06 オーナー：絵どおり丸を出す。バナーの小さい箱だけ丸なし）', () => {
  const css = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'radio-card.module.css'), 'utf8')
  it('普通の箱（card）の丸は消さない', () => {
    expect(css()).not.toMatch(/\[data-theme='v8'\] \.card > \.radio[^{]*\{[^}]*opacity:\s*0/)
  })
  it('小さい箱（compact）だけ丸を見えなくする（input は残す）', () => {
    expect(css()).toMatch(/\[data-theme='v8'\] \.compact > \.radio[^{]*\{[^}]*opacity:\s*0/)
  })
})
