import { globalTokens, resolveValue } from '../../scripts/card-shape-contract.mjs'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const WEB = path.join(__dirname, '..', '..')
const CSS = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8')
const BUTTON = fs.readFileSync(path.join(WEB, 'src', 'components', 'shared', 'button.module.css'), 'utf8')

const CURRENT_TOKENS = globalTokens(CSS)
function token(name: string): string {
  if (!CURRENT_TOKENS.has(`--${name}`)) throw new Error(`Missing CSS token: ${name}`)
  return resolveValue(`var(--${name})`, CURRENT_TOKENS).trim()
}

/**
 * **値が同じでも、名前を分けたままにするもの。**
 *
 * ここに載るのは「いまたまたま同じ値だが、役割が別なので片方だけ
 * 変わりうる」もの。名前を1本にすると、変えたい側だけを変えられなくなる。
 * **増やすときは理由を書く。**
 */
const ALLOWED_SAME_VALUE = [
  // §6: 主操作と成功、危険の札と危険操作は役割別に名前を残す。
  '--color-accent-deep / --color-success',
  '--color-danger / --color-status-danger',
  // §6 : 区切り線と枠線は同じ黒7%。
  '--color-hairline / --color-divider',
  // V8の薄い面と表見出しは現在同じ背景。役割ごとの入口を残す。
  '--color-surface-pearl / --color-table-head',
  // 面と、その上の文字は別の役割。
  '--color-on-accent / --color-on-action / --color-canvas',
  // 既存の字重の別名。大きな数以外は600。
  '--font-weight-bold / --font-weight-extrabold',
  // §6: 大きな数。
  '--text-hero / --text-metric',
  // : 補足・本文・小さい文字は現在1.5。サイズに対応する入口を維持する。
  '--text-caption--line-height / --text-body--line-height / --text-micro--line-height',
  '--text-lead--line-height / --text-heading--line-height / --text-title--line-height',
]

/** ★V8の写しと§6の共通値。値の変更は先にPencil・決まりを更新する。 */
describe('設計の実測値に合わせる', () => {
  it('文字の段は設計の10段と一致する', () => {
    // Pencil: $size-nano..$size-display
    expect(token('text-nano')).toBe('10px')
    expect(token('text-micro')).toBe('11px')
    expect(token('text-caption')).toBe('12px')
    expect(token('text-label')).toBe('12px')
    expect(token('text-body')).toBe('13px')
    expect(token('text-lead')).toBe('15px')
    expect(token('text-heading')).toBe('15px')
    expect(token('text-title')).toBe('20px')
    expect(token('text-metric')).toBe('28px')
    expect(token('text-display')).toBe('22px')
  })

  it('角丸は設計にある値だけを使う', () => {
    // カード12・窓16・操作10。印・旧部品の段も名前を分けて残す。
    const design = new Set(['3px', '6px', '8px', '10px', '12px', '16px', '18px', '9999px'])
    for (const name of ['radius-control', 'radius-control', 'radius-card', 'radius-panel']) {
      expect(design.has(token(name)), `${name} が設計に無い値`).toBe(true)
    }
  })

  it('役割ごとの角丸がトークンとして存在する', () => {
    // 設計: xxs3 / xs6 / sm8 / md10 / panel12 / lg18 / full9999
    expect(token('radius-icon')).toBe('6px')
    expect(token('radius-mini')).toBe('6px')
    expect(token('radius-control')).toBe('10px')
    expect(token('radius-card')).toBe('12px')
    expect(token('radius-panel')).toBe('16px')
    expect(token('radius-large')).toBe('16px') // 既存の rounded-lg へ波及させない専用名
    expect(token('radius-pill')).toBe('999px')
  })

  it("管理画面の18pxをTailwind既定の rounded-lg へ流し込まない", () => {
    // `--radius-lg` をここで定義すると、管理画面専用の2箇所だけでなく
    // 既存の `rounded-lg` 利用先85ファイルが8pxから18pxへ変わる。
    expect(CSS).not.toMatch(/--radius-lg:\s*18px/)
    expect(token('radius-large')).toBe('16px')
  })

  // 役割が異なる同値トークンだけ、上の理由付き一覧で許可する。
  it('同じ系統の中に、同じ値のトークンを2つ置かない', () => {
    const theme = CSS.slice(CSS.indexOf('@theme {'), CSS.indexOf('\n}\n', CSS.indexOf('@theme {')))
    const tokens = [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*--([a-z0-9]+)-([a-z0-9-]+):\s*([^;]+);/gm)]
    const byFamily = new Map<string, Map<string, string[]>>()
    for (const [, family, rest, raw] of tokens) {
      const value = raw.trim().toLowerCase()
      // 既存の役割別名は参照先を共有する。ここでは独立した生の値を点検する。
      if (value.includes('var(')) continue
      if (!byFamily.has(family)) byFamily.set(family, new Map())
      const bucket = byFamily.get(family)!
      if (!bucket.has(value)) bucket.set(value, [])
      bucket.get(value)!.push(`--${family}-${rest}`)
    }
    const found = new Set<string>()
    for (const bucket of byFamily.values())
      for (const names of bucket.values()) if (names.length > 1) found.add(names.join(' / '))
    expect([...found].sort(), '同じ値のトークンが増えた。名前を1本にするか、値を分ける').toEqual(
      [...ALLOWED_SAME_VALUE].sort(),
    )
  })

  it("管理画面 の別系統トークンを残さない", () => {
    // `--color-管理画面-*` `--radius-管理画面-*` `--shadow-管理画面-*` は 1 系統へ畳んだ。
    const theme = CSS.slice(CSS.indexOf('@theme {'), CSS.indexOf('\n}\n', CSS.indexOf('@theme {')))
    const left = [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[a-z0-9-]*-v6-[a-z0-9-]+):/gm)].map((m) => m[1])
    expect(left, 'V6 専用の別名トークンが戻っている').toEqual([])
  })

  /*
   * **主ボタンは `$accent-deep`(#087a3e) + 白文字。**
   *
   * LINE の緑 `$accent`(#06c755) に白文字を乗せると 2.26:1 しか無い。
   * ラベルは 13px なので AA の 4.5:1 に届かない。`$accent-deep` は 5.44:1。
   * **新しい色は作らない**——Pencil のトークン表にある色だけを使う
   * （決定 2026-09-03、正本は要件索引 §5-2）。
   *
   * `$accent` は消さない。選択状態・チップ・有効表示に残す。
   */
  it('主ボタンは accent-deep の地に白文字を乗せる', () => {
    expect(token('color-accent-deep')).toBe('#087a3e')
    expect(token('color-on-accent')).toBe('#ffffff')
    expect(BUTTON).toMatch(/\.primary\s*\{[^}]*background:\s*var\(--color-accent-deep\)/s)
    expect(BUTTON).toMatch(/\.primary\s*\{[^}]*color:\s*var\(--color-on-accent\)/s)
    // LINE の緑は残す（文字が乗らない用途で使う）
    expect(token('color-accent')).toBe('#06c755')
  })

  // V8ではPC36px、タッチ端末は44pxの当たりを維持する。
  it('共通ボタンは現在のV8の高さ・余白・文字を使う', () => {
    expect(BUTTON).toMatch(/:root \.standard,\s*:root \.field\s*{[^}]*height:\s*var\(--tpl-button-h\)/s)
    expect(token('tpl-button-h')).toBe('36px')
    expect(BUTTON).toMatch(/padding:\s*0 var\(--tpl-button-pad-side\)/)
    expect(token('tpl-button-pad-side')).toBe('16px')
    expect(BUTTON).toMatch(/border-radius:\s*var\(--radius-control\)/)
    expect(token('radius-control')).toBe('10px')
    expect(BUTTON).toMatch(/font-size:\s*var\(--text-body\)/)
    expect(BUTTON).toMatch(/:root \.button\s*{[^}]*font-weight:\s*var\(--tpl-button-weight\)/s)
    expect(token('tpl-button-weight')).toBe('600')
    // ：文字だけの操作もボタンの太さ600。本文400へ戻さない。
    expect(BUTTON).toMatch(/:root \.button\.inline\.text\s*{[^}]*font-weight:\s*var\(--font-weight-bold\)/s)
    expect(token('font-weight-bold')).toBe('600')
    // タッチ端末（pointer: coarse）は44pxの当たり判定を確保する
    expect(BUTTON).toMatch(/@media\s*\(pointer:\s*coarse\)[^{]*\{[^}]*min-height:\s*44px/s)
  })
})
