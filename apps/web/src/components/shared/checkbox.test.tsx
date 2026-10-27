// @vitest-environment happy-dom
/*
 * ★管理画面 共通 チェックボックス（gvjpx）。
 * 本物の input を使うので、押す・Space・読み上げはブラウザの標準のまま。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Checkbox, { CHECK_MARK_PATH, CheckboxControl, MINUS_MARK_PATH, SettingCheckbox } from './checkbox'
import CheckCard from './check-card'

afterEach(() => cleanup())

function Harness({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial)
  return <Checkbox checked={checked} onCheckedChange={setChecked}>すべての友だちに送る</Checkbox>
}

describe("チェックボックス", () => {
  it('文字を押しても切り替わり、読み上げ名は文字になる', () => {
    render(<Harness />)
    const box = screen.getByRole('checkbox', { name: 'すべての友だちに送る' }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(screen.getByText('すべての友だちに送る'))
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })

  it('一部選択は input の indeterminate に入る（属性では表せない）', () => {
    const { rerender } = render(<Checkbox checked={false} indeterminate onCheckedChange={() => {}} aria-label="表示中の友だちをすべて選ぶ" />)
    const box = screen.getByRole('checkbox', { name: '表示中の友だちをすべて選ぶ' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    rerender(<Checkbox checked indeterminate={false} onCheckedChange={() => {}} aria-label="表示中の友だちをすべて選ぶ" />)
    expect(box.indeterminate).toBe(false)
  })

  it('誤りの文は aria-describedby でつながり、aria-invalid が立つ', () => {
    render(<Checkbox checked={false} onCheckedChange={() => {}} error="同意しないと先へ進めません">利用規約に同意する</Checkbox>)
    const box = screen.getByRole('checkbox', { name: '利用規約に同意する' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    const note = document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe('同意しないと先へ進めません')
  })

  it('無効のときは押しても変わらない', () => {
    let changes = 0
    render(<Checkbox checked={false} disabled onCheckedChange={() => { changes += 1 }}>すべての友だちに送る</Checkbox>)
    fireEvent.click(screen.getByText('すべての友だちに送る'))
    expect(changes).toBe(0)
  })

  it('押せる24pxは札のpaddingで受け、inputは箱からはみ出さない（M3報告のはみ出し対応）', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'checkbox.module.css'), 'utf8')
    // input は 18px の箱に収める（負の inset で外へ出さない）。
    expect(css).toMatch(/\.input \{\s*position:\s*absolute;\s*inset:\s*0;/s)
  })
})


describe('固定の設定の理由と通常の切り替え', () => {
  it('常にオンの項目は値と理由を保ち、押しても外れない', () => {
    const changes: boolean[] = []
    render(<SettingCheckbox checked={false} locked label="URLを短縮して数える" onChange={(value) => changes.push(value)} />)
    const box = screen.getByRole('checkbox', { name: 'URLを短縮して数える' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    expect(box.title).toBe('この設定は常にオンです')
    expect(box.getAttribute('aria-description')).toBe('この設定は常にオンです')
    fireEvent.click(box)
    expect(changes).toEqual([])
  })
  it('通常の項目には固定の理由を付けず、選んだ値を通知する', () => {
    const changes: boolean[] = []
    render(<SettingCheckbox checked={false} label="抽選する" onChange={(value) => changes.push(value)} />)
    const box = screen.getByRole('checkbox', { name: '抽選する' }) as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.hasAttribute('title')).toBe(false)
    expect(box.hasAttribute('aria-description')).toBe(false)
    fireEvent.click(box)
    expect(changes).toEqual([true])
  })
})

describe('チェックボックスは1種類', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  // 素の <input type="checkbox"> を書いてよいのは共通部品の中だけ。
  const RAW = /<input[^>]*type=["']checkbox["']/s

  it('画面と部品は共通の Checkbox・CheckboxControl を使い、素のチェックを置かない', () => {
    const found = walk(SRC)
      .filter((path) => path.endsWith('.tsx') && !path.includes('.test.') && !path.endsWith('components/shared/checkbox.tsx'))
      .filter((path) => RAW.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1))
    expect(found).toEqual([])
    expect(RAW.test('<input\n  type="checkbox"\n  checked />')).toBe(true)
  })

  it('選ぶカードの四角は Checkbox と同じ作り（同じ四角と同じ印）', () => {
    const { container: card } = render(<CheckCard title="店頭QR" checked onChange={() => {}} />)
    const { container: plain } = render(<CheckboxControl checked onCheckedChange={() => {}} aria-label="店頭QR" />)
    const shape = (root: HTMLElement) => root.querySelector('input[type="checkbox"]')!.parentElement!.innerHTML.replace(/ (id|aria-[a-z]+)="[^"]*"/g, '')
    expect(shape(card)).toBe(shape(plain))
  })
})

/** M・l・h だけの線の外接箱（viewBox の単位）。線の太さは上下左右に同じだけ足すので中心は変わらない。 */
function pathBox(d: string) {
  const points: Array<[number, number]> = []
  let x = 0
  let y = 0
  for (const [, op, args] of d.matchAll(/([MLlh])([^MLlh]*)/g)) {
    const nums = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number)
    if (op === 'h') { for (const dx of nums) { x += dx; points.push([x, y]) } continue }
    for (let i = 0; i < nums.length; i += 2) {
      if (op === 'l') { x += nums[i]; y += nums[i + 1] } else { x = nums[i]; y = nums[i + 1] }
      points.push([x, y])
    }
  }
  const xs = points.map(([px]) => px)
  const ys = points.map(([, py]) => py)
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

describe('印は箱の真ん中（上下左右とも 0.1px 以内）', () => {
  // 印は箱と同じ大きさ（--polish-icon-control 16px）で viewBox 24 を描く。1 単位＝16/24px。
  const PX_PER_UNIT = 16 / 24
  const LIMIT = 0.1
  it.each([['✓', CHECK_MARK_PATH], ['－', MINUS_MARK_PATH]])('%s の外接箱の中心が (12, 12) から 0.1px 以内', (_name, d) => {
    const { cx, cy } = pathBox(d)
    expect(Math.abs(cx - 12) * PX_PER_UNIT).toBeLessThanOrEqual(LIMIT)
    expect(Math.abs(cy - 12) * PX_PER_UNIT).toBeLessThanOrEqual(LIMIT)
  })
  it('対照：中心が約0.33pxずれた線も許容範囲を超える', () => {
    expect(Math.abs(pathBox('M4 12l5 5L20 6').cy - 12) * PX_PER_UNIT).toBeGreaterThan(LIMIT)
  })
  it('部品は真ん中にそろえた印の線を描く', () => {
    const { container } = render(<Checkbox checked onCheckedChange={() => {}} aria-label="選ぶ" />)
    const paths = [...container.querySelectorAll('svg path')].map((path) => path.getAttribute('d'))
    expect(paths).toEqual([CHECK_MARK_PATH, MINUS_MARK_PATH])
  })
})
