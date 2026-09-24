// @vitest-environment happy-dom
/*
 * Issue #702（監査6実測: 低コントラスト4件）の契約テスト。
 * 札は「薄い同系背景＋濃い同系文字」の規則へ統一し、本文サイズの文字は
 * すべて WCAG AA の 4.5:1 以上にする。色の実値は globals.css の正本から
 * 読み、WCAG の式で割り直す（決め打ちの比は書かない）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '../components/shared/status-badge'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

/* WCAG 2.2 の相対輝度とコントラスト比。監査の実測値と突き合わせ済み。 */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}
function ratio(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function tokenMap(): Map<string, string> {
  const css = read('globals.css')
  const map = new Map<string, string>()
  for (const match of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map.set(match[1], match[2].toLowerCase())
  }
  return map
}

describe('Issue #702: 札の文字色と背景の組み合わせは 4.5:1 以上', () => {
  const tokens = tokenMap()
  const pair = (fg: string, bg: string): [string, string] => {
    const f = tokens.get(fg)
    const b = tokens.get(bg)
    expect(f, `トークン --color-${fg} が見つかる`).toBeDefined()
    expect(b, `トークン --color-${bg} が見つかる`).toBeDefined()
    return [f!.replace('#', ''), b!.replace('#', '')]
  }
  const cases = [
    ['accent-deep', 'on-accent', '選んだタブ（白文字 on 濃い緑）'],
    ['danger', 'status-danger-soft', '設定不足バッジ（危険・濃赤 on 薄赤）'],
    ['ink-secondary', 'shell', '下書きバッジ（濃灰 on 薄灰）'],
    ['success', 'success-bg', '公開中バッジ（濃緑 on 薄緑）'],
    ['warning', 'warning-bg', '停止中・アーカイブ札（濃黄土 on 薄黄）'],
    ['accent-deep', 'accent-soft', '成功バッジ（濃緑 on 薄緑）'],
    ['status-info', 'status-info-soft', '情報バッジ（濃青 on 薄青）'],
    ['status-warn-deep', 'status-warn-soft', '注意バッジ（濃飴 on 薄飴）'],
    ['ink-faint', 'canvas-sunken', '停止中・薄い札（グレー on 沈み面）'],
  ] as const

  for (const [fg, bg, name] of cases) {
    it(`${name}: ${fg} on ${bg} は 4.5:1 以上`, () => {
      const [f, b] = pair(fg, bg)
      expect(ratio(f, b)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('直す前の組み合わせ（白 on 明るいLINE緑 2.26:1・赤 3.53:1）は 4.5 未満で落ちる', () => {
    expect(ratio('ffffff', '06c755')).toBeLessThan(4.5)
    expect(ratio('e5484d', 'fef0f0')).toBeLessThan(4.5)
  })
})

describe('Issue #702: 危険バッジは濃い赤のトークンを指す', () => {
  const css = read('../components/shared/status-badge.module.css')

  it('.danger の文字色は --color-danger（個別の赤指定は残さない）', () => {
    expect(css).toContain('color: var(--color-danger)')
    expect(css).not.toContain('color: var(--color-status-danger);')
  })
})

describe('Issue #702: 4画面の札・タブはトークンで書く', () => {
  it('ウェビナー一覧の状態札は薄い背景＋濃い文字の3組（生の灰・緑・黄は使わない）', () => {
    const page = read('webinars/page.tsx')
    expect(page).toContain("draft: 'bg-shell text-ink-secondary'")
    expect(page).toContain("active: 'bg-success-bg text-success'")
    expect(page).toContain("archived: 'bg-warning-bg text-warning'")
    expect(page).not.toContain('bg-gray-100 text-gray-600')
    expect(page).not.toContain('bg-green-100 text-green-700')
    expect(page).not.toContain('bg-amber-100 text-amber-700')
  })

  it('自動応答の凡例の札は成功・注意トークン（生の緑700・黄700は使わない）', () => {
    const page = read('auto-replies/page.tsx')
    expect(page).toContain('bg-success-bg text-success')
    expect(page).toContain('bg-warning-bg text-warning')
    expect(page).not.toContain('text-green-700')
    expect(page).not.toContain('bg-amber-50 text-amber-700')
  })

  it('テンプレートの種類タブ：選んだ札を明るい緑で上書きしない（濃い緑のまま）', () => {
    const page = read('templates/page.tsx')
    expect(page).toContain("bg-accent-deep text-on-accent'")
    expect(page).not.toContain("backgroundColor: 'var(--color-accent)'")
  })

  it('リッチメニュー編集のページ札も同じ規則（明るい緑の上書き・生の黄は使わない）', () => {
    const page = read('rich-menus/edit/page.tsx')
    expect(page).toContain('bg-accent-deep text-white')
    expect(page).toContain('bg-warning-bg p-2 text-[11px] text-warning')
    expect(page).not.toContain("backgroundColor: 'var(--color-accent)'")
    expect(page).not.toContain('bg-amber-50 p-2 text-[11px] text-amber-700')
  })
})

describe('Issue #702: 共通バッジは5つの調子すべて実Reactで描ける', () => {
  it.each([
    ['neutral', '下書き'],
    ['info', '配信待ち'],
    ['warning', '停止中'],
    ['success', '配信中'],
    ['danger', '設定不足'],
  ] as const)('%s の札に文字が出る', (tone, label) => {
    const { unmount } = render(<StatusBadge tone={tone}>{label}</StatusBadge>)
    expect(screen.getByText(label)).toBeTruthy()
    unmount()
  })
})
