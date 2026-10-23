// @vitest-environment happy-dom
/*
 * Issue #702（監査6実測: 低コントラスト4件）の契約テスト。
 * 札は「薄い同系背景＋濃い同系文字」の規則へ統一し、本文サイズの文字は
 * すべて WCAG AA の 4.5:1 以上にする。色の実値は globals.css の正本から
 * 読み、WCAG の式で割り直す（決め打ちの比は書かない）。
 */
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
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
  for (const match of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)/g)) {
    const hex = match[2].slice(1)
    const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1
    const color = [0, 2, 4].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')).join('')
    map.set(match[1], '#' + color)
  }
  for (const match of css.matchAll(/--color-([\w-]+):\s*var\(--color-([\w-]+)\)/g)) {
    const resolved = map.get(match[2])
    if (resolved) map.set(match[1], resolved)
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
    ['status-info-deep', 'status-info-soft', '情報バッジ（濃青 on 薄青）'],
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

describe('Issue #702: 共通バッジは5つの調子すべて実Reactで描ける', () => {
  it.each([
    ['neutral', '下書き'],
    ['info', '予約中'],
    ['warning', '停止中'],
    ['success', '配信中'],
    ['danger', '設定不足'],
  ] as const)('%s の札に文字が出る', (tone, label) => {
    const { unmount } = render(<StatusBadge tone={tone}>{label}</StatusBadge>)
    expect(screen.getByText(label)).toBeTruthy()
    unmount()
  })
})
