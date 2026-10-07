// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import ExportSizeChip from './export-size-chip'

/*
 * 書き出す大きさの札（★BG-B `qIp42` → `X2oLn` 下部追従バーの中ほど `WDJak`）。
 *
 * 2026-10-07 の差し戻し: 薄い文字だけで出していて、絵の
 * 「薄い緑の丸い札＋切り抜きの絵＋濃い緑の小さな太字」と違っていた。
 * 絵の値（`$accent-soft` / `$radius-full` / 6・12 / 間6 / 14px / `$size-micro` / 600）を
 * ここで見張る。文字の見た目を薄い文字へ戻すとこの試験が落ちる。
 */
afterEach(cleanup)

const CSS = fs.readFileSync(path.join(__dirname, 'export-size-chip.module.css'), 'utf8')
const CHIP = CSS.match(/\.chip \{([^}]*)\}/s)?.[1] ?? ''

describe('書き出す大きさの札', () => {
  it('寸法の文を出す', () => {
    render(<ExportSizeChip text="1040 × 1040 で書き出します" />)
    expect(screen.getByText('1040 × 1040 で書き出します')).toBeTruthy()
  })

  it('札の中に絵を置く（`c5NlW`）', () => {
    const { container } = render(<ExportSizeChip text="1080 × 1920 で書き出します" />)
    // lucide の `crop`。読み上げには出さない（文のほうを読ませる）。
    const icon = container.querySelector('svg')
    expect(icon).toBeTruthy()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('用途が未選択（空文字）なら何も描かない', () => {
    const { container } = render(<ExportSizeChip text="" />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('絵の値どおりの札にする（薄い文字に戻さない）', () => {
    expect(CHIP).toMatch(/background:\s*var\(--color-accent-soft\)/)
    expect(CHIP).toMatch(/color:\s*var\(--color-accent-deep\)/)
    expect(CHIP).toMatch(/border-radius:\s*var\(--radius-pill\)/)
    expect(CHIP).toMatch(/padding:\s*6px 12px/)
    expect(CHIP).toMatch(/gap:\s*6px/)
    expect(CHIP).toMatch(/font-size:\s*var\(--text-micro\)/)
    expect(CHIP).toMatch(/font-weight:\s*600/)
    // 薄い文字（`$ink-faint`）や本文サイズへ戻っていないこと。
    expect(CHIP).not.toMatch(/--color-ink-faint/)
    expect(CHIP).not.toMatch(/font-size:\s*var\(--text-caption\)/)
    // 絵 14×14。
    expect(CSS).toMatch(/\.icon \{[^}]*width:\s*14px/s)
    expect(CSS).toMatch(/\.icon \{[^}]*height:\s*14px/s)
  })
})

describe('札の置き場所', () => {
  const v7 = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app/hq/banners/project/page.tsx'), 'utf8')
  const v8 = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'v8/hq-banners/project.tsx'), 'utf8')

  it('v7 は下部追従バーの `info`（中ほど）に札を渡す', () => {
    expect(v7).toContain('ExportSizeChip')
    // 帯の `info` に渡す。パネルの中には置かない。
    expect(v7).toMatch(/info=\{[\s\S]{0,200}ExportSizeChip/)
  })

  it('v8 も同じ札を下の行に置く（薄い文字で出し直さない）', () => {
    expect(v8).toContain('ExportSizeChip')
    expect(v8).not.toMatch(/styles\.hint\}>\{exportSizeText/)
  })

  it('v7・v8 とも寸法の文は `exportSizeText` から組む（決め打ちしない）', () => {
    expect(v7).toMatch(/text=\{exportSizeText\(presets, input\.presetKey\)\}/)
    expect(v8).toMatch(/text=\{exportSizeText\(presets, input\.presetKey\)\}/)
    for (const source of [v7, v8]) {
      expect(source).not.toMatch(/'1040 × 1040 で書き出します'/)
    }
  })
})
